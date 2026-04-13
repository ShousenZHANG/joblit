import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth";
import type { VideoItem, VideosResponse } from "@/app/(app)/discover/types";

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const cache = new Map<string, { data: VideosResponse; expiry: number }>();

function daysAgoISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

// Multiple broader queries to maximize results while staying on-topic
const SEARCH_QUERIES = [
  "Claude AI tutorial",
  "Anthropic Claude coding",
  "RAG tutorial LLM",
  "AI agent building 2026",
  "Claude Code programming",
  "AI harness engineering",
  "software engineering AI tools",
];

async function searchYouTube(
  query: string,
  apiKey: string,
  maxResults: number,
): Promise<string[]> {
  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("q", query);
  url.searchParams.set("type", "video");
  url.searchParams.set("order", "relevance");
  url.searchParams.set("publishedAfter", daysAgoISO(30));
  url.searchParams.set("maxResults", String(maxResults));
  url.searchParams.set("relevanceLanguage", "en");
  url.searchParams.set("videoDuration", "medium"); // 4-20 min (skip shorts)
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
  if (!res.ok) {
    console.warn(`YouTube search "${query}" returned ${res.status}`);
    return [];
  }

  const json = await res.json();
  return (json.items ?? [])
    .map((item: any) => item.id?.videoId)
    .filter(Boolean);
}

async function fetchVideoStats(
  videoIds: string[],
  apiKey: string,
): Promise<VideoItem[]> {
  if (videoIds.length === 0) return [];

  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("part", "statistics,snippet");
  url.searchParams.set("id", videoIds.join(","));
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`YouTube Videos API ${res.status}`);

  const json = await res.json();
  return (json.items ?? []).map((item: any) => ({
    id: item.id,
    title: item.snippet?.title ?? "",
    url: `https://www.youtube.com/watch?v=${item.id}`,
    thumbnailUrl:
      item.snippet?.thumbnails?.medium?.url ??
      item.snippet?.thumbnails?.default?.url ??
      "",
    channelName: item.snippet?.channelTitle ?? "",
    viewCount: Number(item.statistics?.viewCount) || 0,
    publishedAt: item.snippet?.publishedAt ?? "",
    description: (item.snippet?.description ?? "").slice(0, 200),
  }));
}

async function fetchYouTube(): Promise<VideoItem[]> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return [];

  // Step 1: Run multiple search queries in parallel (5 queries × 6 results each)
  const searchResults = await Promise.all(
    SEARCH_QUERIES.map((q) => searchYouTube(q, apiKey, 6)),
  );

  // Step 2: Deduplicate video IDs
  const seen = new Set<string>();
  const uniqueIds: string[] = [];
  for (const ids of searchResults) {
    for (const id of ids) {
      if (!seen.has(id)) {
        seen.add(id);
        uniqueIds.push(id);
      }
    }
  }

  // Step 3: Fetch stats in batch (max 50 per request)
  const videos = await fetchVideoStats(uniqueIds.slice(0, 50), apiKey);

  // Step 4: Sort by view count descending
  return videos.sort((a, b) => b.viewCount - a.viewCount);
}

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.YOUTUBE_API_KEY) {
    return NextResponse.json({
      items: [],
      cached: false,
      fetchedAt: new Date().toISOString(),
      noApiKey: true,
    });
  }

  const cacheKey = "videos";
  const cached = cache.get(cacheKey);
  if (cached && Date.now() < cached.expiry) {
    return NextResponse.json(cached.data);
  }

  try {
    const items = await fetchYouTube();
    const response: VideosResponse = {
      items,
      cached: false,
      fetchedAt: new Date().toISOString(),
    };
    cache.set(cacheKey, {
      data: { ...response, cached: true },
      expiry: Date.now() + CACHE_TTL_MS,
    });
    return NextResponse.json(response);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to fetch videos";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
