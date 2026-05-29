import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/prisma";
import { constantTimeEqual } from "@/lib/server/auth/constantTimeEqual";

export const runtime = "nodejs";

const STUCK_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
const TIMEOUT_ERROR_MESSAGE = "Dispatch timeout: worker did not report status within 30 minutes";

/**
 * GET /api/fetch-runs/cleanup-stuck
 *
 * Manually-callable endpoint that marks QUEUED/RUNNING runs older than 30
 * minutes as FAILED. Without this sweeper, workers that crash or lose network
 * mid-run leave their FetchRun row stuck forever — users see a perpetual spinner.
 *
 * Auth: requires `x-fetch-run-secret` header matching FETCH_RUN_SECRET env var.
 * Same secret used by the Python worker for callback endpoints.
 *
 * Trigger options:
 *   - GitHub Actions scheduled workflow (recommended) — call this endpoint
 *     from a cron-schedule workflow with the secret header.
 *   - Manual curl for ops/debug.
 */
export async function GET(req: Request) {
  const secret = process.env.FETCH_RUN_SECRET;
  const provided = req.headers.get("x-fetch-run-secret") ?? "";

  if (!secret) {
    return NextResponse.json({ error: "NOT_CONFIGURED" }, { status: 503 });
  }
  if (!constantTimeEqual(provided, secret)) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS);

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
      id: { in: stuckRuns.map((r) => r.id) },
      status: { in: ["QUEUED", "RUNNING"] },
    },
    data: {
      status: "FAILED",
      error: TIMEOUT_ERROR_MESSAGE,
    },
  });

  return NextResponse.json({
    swept: result.count,
    ids: stuckRuns.map((r) => r.id),
    thresholdMinutes: STUCK_THRESHOLD_MS / 60_000,
  });
}
