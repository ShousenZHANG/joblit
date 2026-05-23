import { NextResponse } from "next/server";
import { checkRateLimit, rateLimitHeaders } from "./rateLimit";

/**
 * Per-user rate limit for the AI generation routes. Each call triggers a
 * paid Gemini request + a LaTeX render, so an unthrottled authenticated
 * user (or a leaked session) is an unbounded cost vector.
 *
 * Window is generous for legitimate use (AI generation is slow; nobody
 * legitimately fires 20 in a minute) but caps scripted abuse. Per-isolate
 * in-memory — for distributed enforcement upgrade rateLimit.ts to a
 * durable store (Upstash) later; this still blocks the common abuse case.
 */
const AI_GENERATION_LIMIT = { limit: 20, windowSeconds: 60 } as const;

/**
 * Returns a 429 NextResponse if the user has exceeded their AI-generation
 * budget, or `null` if the request may proceed.
 */
export function enforceAiRateLimit(
  userId: string,
  requestId: string,
): NextResponse | null {
  const result = checkRateLimit(`ai:${userId}`, AI_GENERATION_LIMIT);
  if (result.allowed) return null;

  const retryAfter = Math.max(0, Math.ceil((result.resetAt - Date.now()) / 1000));
  return NextResponse.json(
    {
      error: {
        code: "RATE_LIMITED",
        message: "Too many generation requests. Please wait a moment and try again.",
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
