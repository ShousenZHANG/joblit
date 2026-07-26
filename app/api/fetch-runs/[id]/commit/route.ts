import { NextResponse } from "next/server";
import { errorJson } from "@/lib/server/api/errorResponse";
import { constantTimeEqual } from "@/lib/server/auth/constantTimeEqual";
import { UuidParamSchema } from "@/lib/shared/schemas/common";
import {
  FetchRunCommitError,
  commitFetchRun,
} from "@/lib/server/fetchRuns/fetchRunCommit";
import { reportError } from "@/lib/server/observability/errorReporter";
import { FetchRunCommitWireCommandSchema } from "@/lib/shared/schemas/fetchRunCommit";

export const runtime = "nodejs";

function hasValidSecret(req: Request): "ok" | "missing" | "invalid" {
  const expected = process.env.FETCH_RUN_SECRET;
  if (!expected) return "missing";
  return constantTimeEqual(req.headers.get("x-fetch-run-secret"), expected)
    ? "ok"
    : "invalid";
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = hasValidSecret(req);
  if (auth === "missing") {
    return errorJson(
      "FETCH_RUN_COMMIT_NOT_CONFIGURED",
      "Fetch run commit service is unavailable",
      503,
    );
  }
  if (auth === "invalid") {
    return errorJson("UNAUTHORIZED", "Unauthorized", 401);
  }

  const parsedParams = UuidParamSchema.safeParse(await ctx.params);
  if (!parsedParams.success) {
    return errorJson("INVALID_PARAMS", "Invalid route parameters", 400);
  }
  const parsedBody = FetchRunCommitWireCommandSchema.safeParse(
    await req.json().catch(() => null),
  );
  if (!parsedBody.success) {
    return errorJson("INVALID_BODY", "Invalid request body", 400, {
      details: parsedBody.error.flatten(),
    });
  }

  try {
    const result = await commitFetchRun({
      ...parsedBody.data,
      runId: parsedParams.data.id,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof FetchRunCommitError) {
      return errorJson(error.code, error.message, error.status, {
        ...(error.details ? { details: error.details } : {}),
      });
    }
    reportError(error, {
      scope: "fetchRuns.commit",
      tags: { runId: parsedParams.data.id },
    });
    return errorJson("FETCH_RUN_COMMIT_FAILED", "Fetch run commit failed", 500);
  }
}
