import { NextResponse } from "next/server";
import { errorJson } from "@/lib/server/api/errorResponse";
import { UuidParamSchema } from "@/lib/shared/schemas/common";
import { prisma } from "@/lib/server/prisma";
import { constantTimeEqual } from "@/lib/server/auth/constantTimeEqual";
import { reportError } from "@/lib/server/observability/errorReporter";
import {
  normalizeFetchRunConfigV1,
  toLegacyFetchRunConfigFields,
} from "@/lib/shared/schemas/fetchRunConfig";
import type { Prisma } from "@/lib/generated/prisma";
import { getRuntimeCapabilities } from "@/lib/server/runtimeCapabilities";

export const runtime = "nodejs";

const FETCH_RUN_CONFIG_SELECT = {
  id: true,
  status: true,
  market: true,
  error: true,
  importedCount: true,
  queries: true,
  location: true,
  hoursOld: true,
  resultsWanted: true,
  includeFromQueries: true,
  filterDescription: true,
} satisfies Prisma.FetchRunSelect;

type StoredFetchRunConfig = Prisma.FetchRunGetPayload<{
  select: typeof FETCH_RUN_CONFIG_SELECT;
}>;

function requireSecret(req: Request): "ok" | "missing" | "invalid" {
  const capability = getRuntimeCapabilities().fetchRunAuthentication;
  if (capability.kind === "invalid") return "missing";
  const got = req.headers.get("x-fetch-run-secret");
  return constantTimeEqual(got, capability.config.secret)
    ? "ok"
    : "invalid";
}

function configResponse(run: StoredFetchRunConfig): NextResponse {
  try {
    const config = normalizeFetchRunConfigV1(run);
    return NextResponse.json({
      run: { ...run, ...toLegacyFetchRunConfigFields(config), config },
    });
  } catch (error) {
    reportError(error, {
      scope: "fetch-runs.config.parse",
      severity: "error",
      tags: { runId: run.id },
    });
    return errorJson(
      "INVALID_FETCH_RUN_CONFIG",
      "Fetch run configuration is invalid",
      500,
    );
  }
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = requireSecret(_req);
  if (auth === "missing") {
    return errorJson(
      "FETCH_RUN_CONFIG_NOT_CONFIGURED",
      "Fetch run configuration service is unavailable",
      503,
    );
  }
  if (auth === "invalid") {
    return errorJson("UNAUTHORIZED", "Unauthorized", 401);
  }

  const params = await ctx.params;
  const parsed = UuidParamSchema.safeParse(params);
  if (!parsed.success) return errorJson("INVALID_PARAMS", "Invalid route parameters", 400);

  const run = await prisma.fetchRun.findUnique({
    where: { id: parsed.data.id },
    select: FETCH_RUN_CONFIG_SELECT,
  });
  if (!run) return errorJson("NOT_FOUND", "Not found", 404);
  return configResponse(run);
}

