import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth";
import type {
  VideoCategory,
  VideoTimeWindow,
  VideosResponse,
} from "@/app/(app)/discover/types";
import { fetchVideosFromYouTube } from "@/lib/server/discover/videoPipeline";
import {
  buildCacheKey,
  isFresh,
  isQuotaExceededError,
  readCache,
  writeCache,
} from "@/lib/server/discover/videoCache";

const DB_CACHE_TTL_MS = 25 * 60 * 60 * 1000; // 25 h — slightly > 24h cron cadence so cache never expires between runs

const VALID_CATEGORIES: VideoCategory[] = [
  "all",
  "claude",
  "anthropic",
  "rag",
  "agents",
  "agent-skills",
  "harness-engineering",
];
const VALID_WINDOWS: VideoTimeWindow[] = ["week", "month"];

function parseCategory(raw: string | null): VideoCategory {
  const v = (raw ?? "all").toLowerCase();
  return (VALID_CATEGORIES as string[]).includes(v)
    ? (v as VideoCategory)
    : "all";
}

function parseWindow(raw: string | null): VideoTimeWindow {
  const v = (raw ?? "month").toLowerCase();
  return (VALID_WINDOWS as string[]).includes(v)
    ? (v as VideoTimeWindow)
    : "month";
}

/**
 * Shared edge-cache headers. `s-maxage` lets Vercel's CDN serve the same
 * JSON for the next hour without re-invoking the function; `stale-while-
 * revalidate` allows serving the same cached JSON for up to 24 h while a
 * single background revalidation happens. This is the first defence
 * against quota drain — most users never touch the serverless function.
 */
const EDGE_CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
} as const;

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      items: [],
      cached: false,
      fetchedAt: new Date().toISOString(),
      noApiKey: true,
    } satisfies VideosResponse);
  }

  const { searchParams } = new URL(request.url);
  const category = parseCategory(searchParams.get("category"));
  const timeWindow = parseWindow(searchParams.get("window"));
  const cacheKey = buildCacheKey(category, timeWindow);

  // ── L2: DB cache (fast path) ──────────────────────────
  const existing = await readCache(cacheKey).catch(() => null);
  if (existing && isFresh(existing, Date.now())) {
    return NextResponse.json(
      {
        ...existing.payload,
        cached: true,
        fetchedAt: existing.fetchedAt.toISOString(),
      } satisfies VideosResponse,
      { headers: EDGE_CACHE_HEADERS },
    );
  }

  // ── Upstream fetch with quota-aware graceful fallback ─
  try {
    const items = await fetchVideosFromYouTube(category, timeWindow, apiKey);
    const fresh: VideosResponse = {
      items,
      cached: false,
      fetchedAt: new Date().toISOString(),
    };
    await writeCache(cacheKey, fresh, DB_CACHE_TTL_MS).catch(() => {
      // Cache write failures are non-fatal — user still gets the data.
    });
    return NextResponse.json(fresh, { headers: EDGE_CACHE_HEADERS });
  } catch (err) {
    if (isQuotaExceededError(err) && existing) {
      // Quota drained and we have *any* previously-stored payload — serve
      // it and flag stale. UI will show "Updated X ago" instead of an
      // empty state. This is the critical UX guarantee during quota burn.
      return NextResponse.json(
        {
          ...existing.payload,
          cached: true,
          stale: true,
          fetchedAt: existing.fetchedAt.toISOString(),
        } satisfies VideosResponse,
        { headers: EDGE_CACHE_HEADERS },
      );
    }
    const message =
      err instanceof Error ? err.message : "Failed to fetch videos";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
