import { NextResponse } from "next/server";
import { processAllQueuedCnRuns } from "@/lib/server/cnFetch/processFetchRun";

export const runtime = "nodejs";
export const maxDuration = 60;

// On-demand CN job fetcher. Replaces the retired GitHub Actions Python
// scraper (tools/fetcher/run_cn_fetcher.py) — see the v2ex / github /
// rsshub adapters in lib/server/cnFetch for the actual source code.
//
// Invocation model:
//   - NOT scheduled on Vercel Cron. Vercel's Hobby plan caps cron jobs at
//     once-per-day total per project, and we spend our one slot on the
//     Discover video refresh. CN fetches run instead on user demand —
//     clicking "Start Fetch" on /fetch now calls processCnFetchRun
//     directly in /api/fetch-runs/[id]/trigger. This endpoint stays live
//     for operator curl triggers and any future scheduled-tier upgrade.
//   - Auth: Authorization: Bearer $CRON_SECRET or x-cron-secret header.
//
// Each invocation sweeps the most-recent QUEUED CN FetchRun per user
// (skipped: RUNNING / SUCCEEDED / FAILED / CANCELLED runs) via
// processAllQueuedCnRuns in lib/server/cnFetch/processFetchRun.ts.

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const bearer = request.headers.get("authorization");
  if (bearer === `Bearer ${secret}`) return true;
  const explicit = request.headers.get("x-cron-secret");
  return explicit === secret;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await processAllQueuedCnRuns({ limit: 50 });
  return NextResponse.json(result);
}

export const POST = GET;
