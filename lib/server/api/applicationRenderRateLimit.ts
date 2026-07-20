import { NextResponse } from "next/server";

import { checkRateLimit, rateLimitHeaders } from "./rateLimit";

// Preview and finalize share one user-level budget because both compile
// LaTeX. Keeping the key independent of applicationId prevents an account
// from multiplying its allowance with random or newly-created UUIDs.
const APPLICATION_RENDER_LIMIT = { limit: 24, windowSeconds: 60 } as const;

export function enforceApplicationRenderRateLimit(
  userId: string,
  requestId: string,
): NextResponse | null {
  const result = checkRateLimit(
    `applications:pdf-render:${userId}`,
    APPLICATION_RENDER_LIMIT,
  );
  if (result.allowed) return null;

  const retryAfter = Math.max(
    0,
    Math.ceil((result.resetAt - Date.now()) / 1000),
  );
  return NextResponse.json(
    {
      error: {
        code: "RATE_LIMITED",
        message: "PDF rendering is updating too quickly. Try again shortly.",
      },
      requestId,
    },
    {
      status: 429,
      headers: {
        ...rateLimitHeaders(result),
        "Retry-After": String(retryAfter),
      },
    },
  );
}
