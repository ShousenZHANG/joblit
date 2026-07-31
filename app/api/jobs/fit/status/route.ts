import { NextResponse } from "next/server";

import { withSessionRoute } from "@/lib/server/api/routeHandler";
import { getFitRunStats } from "@/lib/server/jobs/fitRunService";

export const runtime = "nodejs";

/**
 * Fit scan progress.
 *
 * Scoring runs in the Runner now, so the Jobs page cannot count what it did
 * itself — it polls this while a scan drains. Two indexed counts, cheap enough
 * for a few-second interval.
 */
export async function GET() {
  return withSessionRoute(async ({ userId }) => {
    return NextResponse.json(await getFitRunStats(userId));
  });
}
