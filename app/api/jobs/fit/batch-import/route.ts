import { NextResponse } from "next/server";
import { withAgentRoute } from "@/lib/server/api/routeHandler";

import { errorJson } from "@/lib/server/api/errorResponse";
import { checkRateLimit, rateLimitHeaders } from "@/lib/server/api/rateLimit";
import { ApplicationPromptError } from "@/lib/server/applications/applicationPrompt";
import {
  FitBatchImportError,
  FitBatchImportRequestSchema,
  settleFitBatchImport,
} from "@/lib/server/jobs/fitBatchImport";

export const runtime = "nodejs";

const BATCH_RATE_LIMIT = { limit: 30, windowSeconds: 60 } as const;

export async function POST(req: Request) {
  return withAgentRoute(req, "fit:drain", async ({ userId }) => {
    const rateLimit = checkRateLimit(`jobs:fit:batch:${userId}`, BATCH_RATE_LIMIT);
    if (!rateLimit.allowed) {
      return errorJson("RATE_LIMITED", "Too many requests", 429, {
        headers: rateLimitHeaders(rateLimit),
      });
    }

    const body = FitBatchImportRequestSchema.safeParse(
      await req.json().catch(() => null),
    );
    if (!body.success) {
      return errorJson("INVALID_BODY", "Invalid request body", 400, {
        details: body.error.flatten(),
      });
    }

    try {
      const settlement = await settleFitBatchImport({
        ...body.data,
        userId,
      });
      return NextResponse.json({ settlement });
    } catch (error) {
      if (error instanceof FitBatchImportError) {
        return errorJson(error.code, error.message, error.status, {
          details: error.details,
        });
      }
      if (error instanceof ApplicationPromptError) {
        return errorJson(error.code, error.message, error.status, {
          details: error.details,
        });
      }
      throw error;
    }
  });
}
