import { NextResponse } from "next/server";
import { errorJson } from "@/lib/server/api/errorResponse";
import { withSessionRoute } from "@/lib/server/api/routeHandler";
import type {
  VideoItem,
  VideoCategory,
  VideoSort,
  VideoTimeWindow,
  VideosResponse,
} from "@/app/(app)/discover/types";
import { fetchVideosFromYouTube } from "@/lib/server/discover/videoPipeline";
import { reportError } from "@/lib/server/observability/errorReporter";
import {
  buildCacheKey,
  isFresh,
  isQuotaExceededError,
  readCache,
  writeCache,
} from "@/lib/server/discover/videoCache";

const DB_CACHE_TTL_MS = 25 * 60 * 60 * 1_000;

const VALID_CATEGORIES: VideoCategory[] = [
  "all",
  "codex",
  "claude",
  "anthropic",
  "rag",
  "agents",
  "agent-skills",
  "harness-engineering",
];
const VALID_WINDOWS: VideoTimeWindow[] = ["week", "month"];
const VALID_SORTS: VideoSort[] = ["trending", "latest", "most_viewed"];

function parseCategory(raw: string | null): VideoCategory {
  const value = (raw ?? "all").toLowerCase();
  return (VALID_CATEGORIES as string[]).includes(value)
    ? (value as VideoCategory)
    : "all";
}

function parseWindow(raw: string | null): VideoTimeWindow {
  const value = (raw ?? "month").toLowerCase();
  return (VALID_WINDOWS as string[]).includes(value)
    ? (value as VideoTimeWindow)
    : "month";
}

function parseSort(raw: string | null): VideoSort {
  const value = (raw ?? "trending").toLowerCase();
  return (VALID_SORTS as string[]).includes(value)
    ? (value as VideoSort)
    : "trending";
}

const EDGE_CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
} as const;

function sortCachedItems(items: VideoItem[], sort: VideoSort): VideoItem[] {
  if (sort === "latest") {
    return [...items].sort(
      (a, b) =>
        new Date(b.publishedAt).getTime() -
        new Date(a.publishedAt).getTime(),
    );
  }
  if (sort === "most_viewed") {
    return [...items].sort(
      (a, b) =>
        b.viewCount - a.viewCount ||
        new Date(b.publishedAt).getTime() -
          new Date(a.publishedAt).getTime(),
    );
  }
  return items;
}

function cachedResponse(
  entry: NonNullable<Awaited<ReturnType<typeof readCache>>>,
  sort: VideoSort,
  extra: Pick<VideosResponse, "stale" | "noApiKey"> = {},
): VideosResponse {
  return {
    ...entry.payload,
    items: sortCachedItems(entry.payload.items, sort),
    cached: true,
    fetchedAt: entry.fetchedAt.toISOString(),
    ...extra,
  };
}

export async function GET(request: Request) {
  return withSessionRoute(async () => {

    const { searchParams } = new URL(request.url);
    const category = parseCategory(searchParams.get("category"));
    const timeWindow = parseWindow(searchParams.get("window"));
    const sort = parseSort(searchParams.get("sort"));
    const cacheKey = buildCacheKey(category, timeWindow, sort);
    const defaultCacheKey =
      sort === "trending" ? cacheKey : buildCacheKey(category, timeWindow);
    const existing = await readCache(cacheKey).catch(() => null);
    const apiKey = process.env.YOUTUBE_API_KEY;

    // Configuration loss must not blank a previously-good feed. Treat the
    // durable cache as stale because this invocation cannot refresh it.
    if (!apiKey) {
      if (existing) {
        return NextResponse.json(
          cachedResponse(existing, sort, { stale: true, noApiKey: true }),
          { headers: EDGE_CACHE_HEADERS },
        );
      }
      if (defaultCacheKey !== cacheKey) {
        const fallback = await readCache(defaultCacheKey).catch(() => null);
        if (fallback) {
          return NextResponse.json(
            cachedResponse(fallback, sort, {
              stale: true,
              noApiKey: true,
            }),
            { headers: EDGE_CACHE_HEADERS },
          );
        }
      }
      return NextResponse.json({
        items: [],
        cached: false,
        fetchedAt: new Date().toISOString(),
        noApiKey: true,
      } satisfies VideosResponse);
    }

    if (existing && isFresh(existing, Date.now())) {
      return NextResponse.json(cachedResponse(existing, sort), {
        headers: EDGE_CACHE_HEADERS,
      });
    }

    try {
      const items = await fetchVideosFromYouTube(
        category,
        timeWindow,
        apiKey,
        sort,
      );
      if (items.length === 0) {
        throw new Error(
          `YouTube returned no videos for ${category}/${timeWindow}/${sort}`,
        );
      }
      const fresh: VideosResponse = {
        items,
        cached: false,
        fetchedAt: new Date().toISOString(),
      };
      await writeCache(cacheKey, fresh, DB_CACHE_TTL_MS).catch(() => {
        // Cache persistence failure cannot invalidate a valid live response.
      });
      return NextResponse.json(fresh, { headers: EDGE_CACHE_HEADERS });
    } catch (error) {
      const quotaExceeded = isQuotaExceededError(error);
      if (!quotaExceeded) {
        reportError(error, { scope: "discover.videos" });
      }

      // Every upstream failure uses LKG when available. This includes network,
      // 5xx, parser, empty-result, and quota failures.
      if (existing) {
        return NextResponse.json(
          cachedResponse(existing, sort, { stale: true }),
          { headers: EDGE_CACHE_HEADERS },
        );
      }
      if (defaultCacheKey !== cacheKey) {
        const fallback = await readCache(defaultCacheKey).catch(() => null);
        if (fallback) {
          return NextResponse.json(
            cachedResponse(fallback, sort, { stale: true }),
            { headers: EDGE_CACHE_HEADERS },
          );
        }
      }

      return errorJson("VIDEOS_UNAVAILABLE", "Videos are unavailable", 502);
    }
  });
}
