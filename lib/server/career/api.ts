import { NextResponse } from "next/server";
import {
  checkRateLimit,
  rateLimitHeaders,
} from "@/lib/server/api/rateLimit";

export function careerRateLimit(
  userId: string,
  scope: string,
  config: { limit: number; windowSeconds: number } = {
    limit: 60,
    windowSeconds: 60,
  },
) {
  const result = checkRateLimit(`career:${scope}:${userId}`, config);
  return result.allowed
    ? { ok: true as const, headers: rateLimitHeaders(result) }
    : {
        ok: false as const,
        response: NextResponse.json(
          {
            error: {
              code: "RATE_LIMITED",
              message: "Too many requests",
            },
          },
          { status: 429, headers: rateLimitHeaders(result) },
        ),
      };
}
