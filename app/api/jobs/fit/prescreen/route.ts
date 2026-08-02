import { NextResponse } from "next/server";
import { withSessionRoute } from "@/lib/server/api/routeHandler";
import { z } from "zod";

import { errorJson } from "@/lib/server/api/errorResponse";
import { checkRateLimit, rateLimitHeaders } from "@/lib/server/api/rateLimit";
import { prescreenSelectedFitJobs } from "@/lib/server/jobs/fitRunService";

export const runtime = "nodejs";

const PRESCREEN_RATE_LIMIT = { limit: 10, windowSeconds: 60 } as const;

const BodySchema = z
  .object({
    jobIds: z.array(z.string().uuid()).min(1).max(200),
  })
  .strict();

/**
 * Deterministic batch prescreen: gazetteer skill overlap marks obvious misses
 * POOR without an AI run and returns the ids still worth a local model pass.
 */
export async function POST(req: Request) {
  return withSessionRoute(async ({ userId }) => {
    const rateLimit = checkRateLimit(
      `jobs:fit:prescreen:${userId}`,
      PRESCREEN_RATE_LIMIT,
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

    return NextResponse.json(
      await prescreenSelectedFitJobs(userId, body.data.jobIds),
    );
  });
}
