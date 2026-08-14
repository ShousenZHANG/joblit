import { NextResponse } from "next/server";
import { errorJson } from "@/lib/server/api/errorResponse";
import { constantTimeEqual } from "@/lib/server/auth/constantTimeEqual";
import { UuidParamSchema } from "@/lib/shared/schemas/common";
import {
  FetchRunCommitError,
  commitFetchRun,
} from "@/lib/server/fetchRuns/fetchRun";
import { reportError } from "@/lib/server/observability/errorReporter";
import { getRuntimeCapabilities } from "@/lib/server/runtimeCapabilities";

export const runtime = "nodejs";

function hasValidSecret(req: Request): "ok" | "missing" | "invalid" {
  const capability = getRuntimeCapabilities().fetchRunAuthentication;
  if (capability.kind === "invalid") return "missing";
  return constantTimeEqual(
    req.headers.get("x-fetch-run-secret"),
    capability.config.secret,
  )
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
  const wireCommand = await req.json().catch(() => null);

  try {
    const result = await commitFetchRun({
      runId: parsedParams.data.id,
      wireCommand,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof FetchRunCommitError) {
      const code =
        error.code === "RUN_MARKET_RETIRED"
          ? "FETCH_MARKET_RETIRED"
          : error.code;
      return errorJson(code, error.message, error.status, {
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
