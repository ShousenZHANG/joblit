import { NextResponse } from "next/server";
import { errorJson } from "@/lib/server/api/errorResponse";
import { constantTimeEqual } from "@/lib/server/auth/constantTimeEqual";
import {
  FETCH_RUN_STALE_AFTER_MS,
  FETCH_RUN_STALE_ERROR,
  fetchRunStaleCutoff,
} from "@/lib/server/fetchRuns/fetchRunQuota";
import { prisma } from "@/lib/server/prisma";

export const runtime = "nodejs";

/**
 * Manual operations endpoint for abandoned FetchRun rows.
 *
 * Normal create, trigger, and status-poll traffic already performs guarded
 * stale-run recovery. This endpoint is retained only for manual diagnostics;
 * product correctness does not depend on a background queue sweep.
 */
export async function GET(req: Request) {
  const secret = process.env.FETCH_RUN_SECRET;
  const provided = req.headers.get("x-fetch-run-secret") ?? "";

  if (!secret) {
    return errorJson("NOT_CONFIGURED", "This endpoint is not configured", 503);
  }
  if (!constantTimeEqual(provided, secret)) {
    return errorJson("UNAUTHORIZED", "Unauthorized", 401);
  }

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

  const result = await prisma.fetchRun.updateMany({
    where: {
      id: { in: stuckRuns.map((run) => run.id) },
      status: { in: ["QUEUED", "RUNNING"] },
      updatedAt: { lt: cutoff },
    },
    data: {
      status: "FAILED",
      error: FETCH_RUN_STALE_ERROR,
    },
  });

  return NextResponse.json({
    swept: result.count,
    ids: stuckRuns.map((run) => run.id),
    thresholdMinutes: FETCH_RUN_STALE_AFTER_MS / 60_000,
  });
}
