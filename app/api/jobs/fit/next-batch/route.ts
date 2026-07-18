import { NextResponse } from "next/server";

import { unauthorizedError } from "@/lib/server/api/errorResponse";
import { checkRateLimit, rateLimitHeaders } from "@/lib/server/api/rateLimit";
import {
  requireSession,
  UnauthorizedError,
  type SessionContext,
} from "@/lib/server/auth/requireSession";
import { nextFitBatch } from "@/lib/server/jobs/fitRunService";

export const runtime = "nodejs";

const BATCH_RATE_LIMIT = { limit: 60, windowSeconds: 60 } as const;

/** Serve the next unscored batch; an empty jobIds array means the scan is done. */
export async function POST() {
  let session: SessionContext;
  try {
    session = await requireSession();
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedError();
    throw err;
  }
  const { userId } = session;

  const rateLimit = checkRateLimit(`jobs:fit:next-batch:${userId}`, BATCH_RATE_LIMIT);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: rateLimitHeaders(rateLimit) },
    );
  }

  return NextResponse.json(await nextFitBatch(userId));
}
