import { NextResponse } from "next/server";
import { errorJson } from "@/lib/server/api/errorResponse";
import { withAgentRoute } from "@/lib/server/api/routeHandler";

import { checkRateLimit, rateLimitHeaders } from "@/lib/server/api/rateLimit";
import { nextFitBatch } from "@/lib/server/jobs/fitRunService";

export const runtime = "nodejs";

const BATCH_RATE_LIMIT = { limit: 60, windowSeconds: 60 } as const;

/**
 * Serve the next unscored batch. Empty jobIds means done only when
 * pendingTotal is zero; fresh leases return a retryAfterMs polling hint.
 */
export async function POST(req: Request) {
  return withAgentRoute(req, async ({ userId }) => {
    const rateLimit = checkRateLimit(`jobs:fit:next-batch:${userId}`, BATCH_RATE_LIMIT);
    if (!rateLimit.allowed) {
      return errorJson("RATE_LIMITED", "Too many requests", 429, {
        headers: rateLimitHeaders(rateLimit),
      });
    }

    return NextResponse.json(await nextFitBatch(userId));
  });
}
