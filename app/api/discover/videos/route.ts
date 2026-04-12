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

async function fetchYouTube(): Promise<VideoItem[]> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return [];

  // Step 1: Search for Claude/Anthropic/RAG focused videos
  const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
  searchUrl.searchParams.set("part", "snippet");
  searchUrl.searchParams.set("q", "Claude Anthropic RAG AI agent tutorial");
  searchUrl.searchParams.set("type", "video");
  searchUrl.searchParams.set("order", "date");
  searchUrl.searchParams.set("publishedAfter", daysAgoISO(14));
  searchUrl.searchParams.set("maxResults", "15");
  searchUrl.searchParams.set("relevanceLanguage", "en");
  searchUrl.searchParams.set("key", apiKey);

  const searchRes = await fetch(searchUrl.toString());
  if (!searchRes.ok) throw new Error(`YouTube Search API ${searchRes.status}`);

  const searchJson = await searchRes.json();
  const searchItems: any[] = searchJson.items ?? [];
  const videoIds = searchItems
    .map((item: any) => item.id?.videoId)
    .filter(Boolean);

  if (videoIds.length === 0) return [];

  // Step 2: Fetch video statistics (view counts) in batch
  const statsUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
  statsUrl.searchParams.set("part", "statistics,snippet");
  statsUrl.searchParams.set("id", videoIds.join(","));
  statsUrl.searchParams.set("key", apiKey);

  const statsRes = await fetch(statsUrl.toString());
  if (!statsRes.ok) throw new Error(`YouTube Videos API ${statsRes.status}`);

  const statsJson = await statsRes.json();
  const statsItems: any[] = statsJson.items ?? [];

  return statsItems.map((item) => ({
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
