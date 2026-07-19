import { NextResponse } from "next/server";

import { unauthorizedError } from "@/lib/server/api/errorResponse";
import { checkRateLimit, rateLimitHeaders } from "@/lib/server/api/rateLimit";
import {
  requireSession,
  UnauthorizedError,
  type SessionContext,
} from "@/lib/server/auth/requireSession";
import {
  getFitRunStats,
  prescreenAllUnscored,
  resetFailedFitBatches,
} from "@/lib/server/jobs/fitRunService";

export const runtime = "nodejs";

const RUN_RATE_LIMIT = { limit: 6, windowSeconds: 60 } as const;

/**
 * Start (or resume) a full-database fit scan: prescreen every unscored NEW
 * job deterministically, then report what is left for the AI pump.
 */
export async function POST() {
  let session: SessionContext;
  try {
    session = await requireSession();
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedError();
    throw err;
  }
  const { userId } = session;

  const rateLimit = checkRateLimit(`jobs:fit:run:${userId}`, RUN_RATE_LIMIT);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: rateLimitHeaders(rateLimit) },
    );
  }

  const retried = await resetFailedFitBatches(userId);
  const { prescreened } = await prescreenAllUnscored(userId);
  const stats = await getFitRunStats(userId);
  return NextResponse.json({ ...stats, prescreened, retried });
}
