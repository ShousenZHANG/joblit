import { NextResponse } from "next/server";
import { errorJson } from "@/lib/server/api/errorResponse";
import { constantTimeEqual } from "@/lib/server/auth/constantTimeEqual";
import { sweepStaleFetchRuns } from "@/lib/server/fetchRuns/fetchRun";
import { getRuntimeCapabilities } from "@/lib/server/runtimeCapabilities";

export const runtime = "nodejs";

function authorizeCleanup(req: Request): NextResponse | null {
  const capability = getRuntimeCapabilities().fetchRunAuthentication;
  if (capability.kind === "invalid") {
    return errorJson("NOT_CONFIGURED", "This endpoint is not configured", 503);
  }
  const provided = req.headers.get("x-fetch-run-secret") ?? "";
  return constantTimeEqual(provided, capability.config.secret)
    ? null
    : errorJson("UNAUTHORIZED", "Unauthorized", 401);
}

/**
 * Manual operations endpoint for abandoned FetchRun rows.
 *
 * Normal create, trigger, and status-poll traffic already performs guarded
 * stale-run recovery. This endpoint is retained only for manual diagnostics;
 * product correctness does not depend on a background queue sweep.
 */
export async function GET(req: Request) {
  const unauthorized = authorizeCleanup(req);
  if (unauthorized) return unauthorized;

  const result = await sweepStaleFetchRuns();
  if (result.candidateCount === 0) {
    return NextResponse.json({ swept: 0, ids: [] });
  }

  return NextResponse.json({
    swept: result.ids.length,
    ids: result.ids,
    thresholdMinutes: result.staleAfterMs / 60_000,
  });
}
