import { NextResponse } from "next/server";
import { errorJson } from "@/lib/server/api/errorResponse";
import { constantTimeEqual } from "@/lib/server/auth/constantTimeEqual";
import {
  FETCH_RUN_STALE_AFTER_MS,
  FETCH_RUN_STALE_ERROR,
  fetchRunStaleCutoff,
} from "@/lib/server/fetchRuns/fetchRunQuota";
import { prisma } from "@/lib/server/prisma";
import {
  FETCH_RUN_COMMIT_PROTOCOL,
  FetchRunCommitError,
  commitFetchRun,
} from "@/lib/server/fetchRuns/fetchRunCommit";

export const runtime = "nodejs";

function authorizeCleanup(req: Request): NextResponse | null {
  const secret = process.env.FETCH_RUN_SECRET;
  if (!secret) {
    return errorJson("NOT_CONFIGURED", "This endpoint is not configured", 503);
  }
  const provided = req.headers.get("x-fetch-run-secret") ?? "";
  return constantTimeEqual(provided, secret)
    ? null
    : errorJson("UNAUTHORIZED", "Unauthorized", 401);
}

async function sweepStuckRun(runId: string, cutoff: Date): Promise<boolean> {
  try {
    const result = await commitFetchRun({
      protocol: FETCH_RUN_COMMIT_PROTOCOL,
      command: "fail",
      runId,
      error: FETCH_RUN_STALE_ERROR,
      staleBefore: cutoff,
    });
    return result.disposition === "APPLIED";
  } catch (error) {
    // Deletion or terminal completion after the stale snapshot is ordinary.
    if (
      error instanceof FetchRunCommitError &&
      (error.code === "RUN_NOT_FOUND" ||
        error.code === "RUN_ALREADY_TERMINAL" ||
        error.code === "RUN_CANCELLED")
    ) {
      return false;
    }
    throw error;
  }
}

async function sweepStuckRuns(
  runIds: readonly string[],
  cutoff: Date,
): Promise<string[]> {
  const swept: string[] = [];
  for (const runId of runIds) {
    if (await sweepStuckRun(runId, cutoff)) swept.push(runId);
  }
  return swept;
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

  const cutoff = fetchRunStaleCutoff();
  const stuckRuns = await prisma.fetchRun.findMany({
    where: {
      status: { in: ["QUEUED", "RUNNING"] },
      updatedAt: { lt: cutoff },
    },
    select: { id: true, status: true, updatedAt: true },
    take: 100,
  });

  if (stuckRuns.length === 0) {
    return NextResponse.json({ swept: 0, ids: [] });
  }

  const sweptIds = await sweepStuckRuns(
    stuckRuns.map((run) => run.id),
    cutoff,
  );

  return NextResponse.json({
    swept: sweptIds.length,
    ids: sweptIds,
    thresholdMinutes: FETCH_RUN_STALE_AFTER_MS / 60_000,
  });
}
