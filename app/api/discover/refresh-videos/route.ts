import { NextResponse } from "next/server";
import type { VideosResponse } from "@/app/(app)/discover/types";
import {
  ALL_VIDEO_CACHE_COMBOS,
  fetchVideosFromYouTube,
} from "@/lib/server/discover/videoPipeline";
import {
  buildCacheKey,
  isQuotaExceededError,
  writeCache,
} from "@/lib/server/discover/videoCache";

// Cron pre-warmer for the video cache. Vercel's cron dispatcher invokes
// this endpoint on the schedule declared in vercel.json. Running on cron
// means the user-facing /api/discover/videos route almost always hits the
// fast DB path, even after a cold start, and the YouTube quota drains
// predictably instead of exploding during a traffic burst.
//
// Authorisation:
//   - Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` automatically
//     when CRON_SECRET is set. We accept that or a matching shared secret
//     via the x-cron-secret header (for local / manual triggers).

const DB_CACHE_TTL_MS = 25 * 60 * 60 * 1000; // 25 h — slightly > 24h cron

export const maxDuration = 60;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail-closed: never run unauthenticated
  const bearer = request.headers.get("authorization");
  if (bearer === `Bearer ${secret}`) return true;
  const explicit = request.headers.get("x-cron-secret");
  return explicit === secret;
}

interface RefreshResult {
  key: string;
  status: "ok" | "quota" | "error";
  itemCount?: number;
  error?: string;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "YOUTUBE_API_KEY not configured" },
      { status: 503 },
    );
  }

  const results: RefreshResult[] = [];
  let quotaHit = false;

  // Sequential iteration — parallel bursts produce rateLimitExceeded
  // errors even when daily quota is still healthy. Short-circuit on the
  // first quotaExceeded to preserve whatever budget remains for users.
  for (const { category, timeWindow } of ALL_VIDEO_CACHE_COMBOS) {
    const key = buildCacheKey(category, timeWindow);
    if (quotaHit) {
      results.push({ key, status: "quota" });
      continue;
    }
    try {
      const items = await fetchVideosFromYouTube(
        category,
        timeWindow,
        apiKey,
      );
      const payload: VideosResponse = {
        items,
        cached: false,
        fetchedAt: new Date().toISOString(),
      };
      await writeCache(key, payload, DB_CACHE_TTL_MS);
      results.push({ key, status: "ok", itemCount: items.length });
    } catch (err) {
      if (isQuotaExceededError(err)) {
        quotaHit = true;
        results.push({ key, status: "quota" });
        continue;
      }
      results.push({
        key,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const summary = {
    refreshedAt: new Date().toISOString(),
    total: results.length,
    ok: results.filter((r) => r.status === "ok").length,
    quota: results.filter((r) => r.status === "quota").length,
    error: results.filter((r) => r.status === "error").length,
    results,
  };
  return NextResponse.json(summary);
}

// Cron dispatches use GET, but allow POST for manual triggers / webhooks
// without changing semantics.
export const POST = GET;
