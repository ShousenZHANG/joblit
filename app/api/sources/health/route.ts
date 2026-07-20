import { NextResponse } from "next/server";
import { z } from "zod";
import { withSessionRoute } from "@/lib/server/api/routeHandler";
import {
  checkRateLimit,
  rateLimitHeaders,
} from "@/lib/server/api/rateLimit";
import { readSourceHealth } from "@/lib/server/sources/readSourceHealth";

export const runtime = "nodejs";

const QuerySchema = z.object({}).strict();

export function GET(req: Request) {
  return withSessionRoute(async ({ userId, requestId }) => {
    const limit = checkRateLimit(`sources:health:get:${userId}`, {
      limit: 60,
      windowSeconds: 60,
    });
    const headers = rateLimitHeaders(limit);
    if (!limit.allowed) {
      return NextResponse.json(
        {
          error: {
            code: "RATE_LIMITED",
            message: "Too many requests",
          },
          requestId,
        },
        { status: 429, headers },
      );
    }
    const query = QuerySchema.safeParse(
      Object.fromEntries(new URL(req.url).searchParams.entries()),
    );
    if (!query.success) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_QUERY",
            message: "Invalid query",
            details: query.error.flatten(),
          },
          requestId,
        },
        { status: 400, headers },
      );
    }

    const data = await readSourceHealth();
    return NextResponse.json(
      { data, requestId },
      {
        headers: {
          ...headers,
          "Cache-Control": "private, no-store",
        },
      },
    );
  });
}
