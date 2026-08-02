import { NextResponse } from "next/server";
import { withAgentRoute } from "@/lib/server/api/routeHandler";
import { z } from "zod";

import { errorJson } from "@/lib/server/api/errorResponse";
import { checkRateLimit, rateLimitHeaders } from "@/lib/server/api/rateLimit";
import {
  FitBatchClaimError,
  releaseFitBatchClaim,
} from "@/lib/server/jobs/fitRunService";

export const runtime = "nodejs";

const RELEASE_RATE_LIMIT = { limit: 60, windowSeconds: 60 } as const;
const BodySchema = z
  .object({
    jobIds: z.array(z.string().uuid()).min(1).max(15),
    claimToken: z.string().uuid(),
  })
  .strict();

export async function POST(req: Request) {
  return withAgentRoute(req, "fit:drain", async ({ userId }) => {
    const rateLimit = checkRateLimit(
      `jobs:fit:release:${userId}`,
      RELEASE_RATE_LIMIT,
    );
    if (!rateLimit.allowed) {
      return errorJson("RATE_LIMITED", "Too many requests", 429, {
        headers: rateLimitHeaders(rateLimit),
      });
    }

    const body = BodySchema.safeParse(await req.json().catch(() => null));
    if (!body.success) {
      return errorJson("INVALID_BODY", "Invalid request body", 400, {
        details: body.error.flatten(),
      });
    }

    try {
      const count = await releaseFitBatchClaim(
        userId,
        body.data.jobIds,
        body.data.claimToken,
      );
      return NextResponse.json({ count });
    } catch (error) {
      if (error instanceof FitBatchClaimError) {
        return errorJson(error.code, error.message, error.status);
      }
      throw error;
    }
  });
}
