import { NextResponse } from "next/server";
import { z } from "zod";

import { errorJson } from "@/lib/server/api/errorResponse";
import { checkRateLimit, rateLimitHeaders } from "@/lib/server/api/rateLimit";
import { withAgentRoute } from "@/lib/server/api/routeHandler";
import {
  FitBatchClaimError,
  heartbeatFitBatchClaim,
} from "@/lib/server/jobs/fitRunService";

export const runtime = "nodejs";

const HEARTBEAT_RATE_LIMIT = { limit: 120, windowSeconds: 60 } as const;
const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
} as const;

const BodySchema = z
  .object({
    claimId: z.string().uuid(),
    attemptId: z.string().uuid(),
  })
  .strict();

/** Renew only the durable Claim lease; Job.updatedAt is not lease state. */
export async function POST(req: Request) {
  return withAgentRoute(req, "fit:drain", async ({ userId, requestId }) => {
    const rateLimit = checkRateLimit(
      `jobs:fit:heartbeat:${userId}`,
      HEARTBEAT_RATE_LIMIT,
    );
    const responseHeaders = {
      ...rateLimitHeaders(rateLimit),
      ...NO_STORE_HEADERS,
      "X-Request-Id": requestId,
    };
    if (!rateLimit.allowed) {
      return errorJson("RATE_LIMITED", "Too many requests", 429, {
        requestId,
        headers: responseHeaders,
      });
    }

    const body = BodySchema.safeParse(await req.json().catch(() => null));
    if (!body.success) {
      return errorJson("INVALID_BODY", "Invalid request body", 400, {
        details: body.error.flatten(),
        requestId,
        headers: responseHeaders,
      });
    }
    try {
      return NextResponse.json(
        await heartbeatFitBatchClaim({ userId, ...body.data }),
        { headers: responseHeaders },
      );
    } catch (error) {
      if (error instanceof FitBatchClaimError) {
        return errorJson(error.code, error.message, error.status, {
          requestId,
          headers: responseHeaders,
        });
      }
      throw error;
    }
  });
}
