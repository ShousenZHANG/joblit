import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth";
import type {
  VideoItem,
  VideoCategory,
  VideosResponse,
} from "@/app/(app)/discover/types";

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const VALID_CATEGORIES: VideoCategory[] = [
  "all",
  "claude",
  "anthropic",
  "rag",
  "agents",
  "mcp",
  "harness",
];

const cache = new Map<string, { data: VideosResponse; expiry: number }>();

function daysAgoISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

// Per-category search query banks. "all" merges deduped union of others.
const CATEGORY_QUERIES: Record<Exclude<VideoCategory, "all">, string[]> = {
  claude: [
    "Claude AI tutorial",
    "Claude Code programming",
    "Anthropic Claude coding",
    "Claude API",
  ],
  anthropic: [
    "Anthropic engineering",
    "Anthropic research",
    "Anthropic AI safety",
  ],
  rag: [
    "RAG tutorial",
    "retrieval augmented generation",
    "vector database RAG",
    "RAG system build",
  ],
  agents: [
    "AI agent building 2026",
    "agentic workflow",
    "autonomous AI agent",
    "agent framework tutorial",
  ],
  mcp: [
    "Model Context Protocol",
    "MCP server tutorial",
    "MCP Anthropic",
  ],
  harness: [
    "AI harness engineering",
    "AI coding workflow",
    "agent harness Claude",
  ],
};

function queriesForCategory(cat: VideoCategory): string[] {
  if (cat === "all") {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const list of Object.values(CATEGORY_QUERIES)) {
      for (const q of list) {
        if (!seen.has(q)) {
          seen.add(q);
          out.push(q);
        }
      }
    }
    return out;
  }
  return CATEGORY_QUERIES[cat];
}

// Hand-curated trusted creator/channel IDs (YouTube channelId, starts with UC).
// Add more over time. Membership boosts ranking but does not gate inclusion.
const TRUSTED_CHANNEL_IDS = new Set<string>([
  "UCrDwWp7EBBv4NwvScIpBDOA", // Anthropic
  "UCawZsQWqfGSbCI5yjkdVkTA", // Matthew Berman
  "UCT2x4v1qY7Pdh4hN4Wq3GAA", // Sam Witteveen
  "UCJxV-MfgTjK_X-vfPmZpHvA", // Hamel Husain (parlance-labs)
  "UCKelCK4ZaO6HeEI1KQjqzWA", // All About AI
  "UCtxCXg-UvSnTKPOzLH4wJaQ", // Coding in Public
  "UCi-g4cjqGV7jvU8aeSuj0jQ", // Greg Kamradt
  "UCxgkN3luQgLQOd_L7tbOdhQ", // AI Jason
  "UC2WmuBuFq6gL08QYG-JjXKw", // Wes Roth
  "UCvWoRowK2zL5J5wwjqeyqzg", // IndyDevDan
  "UCnyqZ8DqgRBxOyqUUKtt-Vg", // David Ondrej
  "UCWv7vMbMWH4-V0ZXdmDpPBA", // Programming with Mosh (general but high quality)
  "UCt53yWQpvm9wWpaCFp8X8MA", // Cole Medin
  "UCa-vrCLQHviTOVnEKDOdetQ", // LangChain
  "UC9OZ7BfqEW9CW4eU0AsAKKw", // LlamaIndex
]);

// ── YouTube API helpers ──────────────────────────────────

async function searchYouTube(
  query: string,
  apiKey: string,
  publishedAfter: string,
  maxResults: number,
): Promise<string[]> {
  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("q", query);
  url.searchParams.set("type", "video");
  url.searchParams.set("order", "relevance");
  url.searchParams.set("publishedAfter", publishedAfter);
  url.searchParams.set("maxResults", String(maxResults));
  url.searchParams.set("relevanceLanguage", "en");
  url.searchParams.set("videoDuration", "medium"); // 4-20 min
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return [];
  const json = await res.json();
  return (json.items ?? [])
    .map((item: { id?: { videoId?: string } }) => item.id?.videoId)
    .filter((id: unknown): id is string => typeof id === "string");
}

interface RawVideo {
  id: string;
  title: string;
  thumbnailUrl: string;
  channelName: string;
  channelId: string;
  viewCount: number;
  likeCount: number;
  publishedAt: string;
  description: string;
  durationSeconds: number;
}

// ISO 8601 duration (PT1H2M3S) → seconds
function parseISODuration(iso: string): number {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  const h = Number(m[1] ?? 0);
  const min = Number(m[2] ?? 0);
  const s = Number(m[3] ?? 0);
  return h * 3600 + min * 60 + s;
}

async function fetchVideoStats(
  videoIds: string[],
  apiKey: string,
): Promise<RawVideo[]> {
  if (videoIds.length === 0) return [];
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("part", "statistics,snippet,contentDetails");
  url.searchParams.set("id", videoIds.join(","));
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`YouTube Videos API ${res.status}`);
  const json = await res.json();
  return (json.items ?? []).map((item: any) => ({
    id: String(item.id ?? ""),
    title: item.snippet?.title ?? "",
    thumbnailUrl:
      item.snippet?.thumbnails?.medium?.url ??
      item.snippet?.thumbnails?.default?.url ??
      "",
    channelName: item.snippet?.channelTitle ?? "",
    channelId: item.snippet?.channelId ?? "",
    viewCount: Number(item.statistics?.viewCount) || 0,
    likeCount: Number(item.statistics?.likeCount) || 0,
    publishedAt: item.snippet?.publishedAt ?? "",
    description: (item.snippet?.description ?? "").slice(0, 200),
    durationSeconds: parseISODuration(item.contentDetails?.duration ?? ""),
  }));
}

async function fetchChannelSubscribers(
  channelIds: string[],
  apiKey: string,
): Promise<Map<string, number>> {
  if (channelIds.length === 0) return new Map();
  // YouTube /channels supports up to 50 IDs per call
  const out = new Map<string, number>();
  for (let i = 0; i < channelIds.length; i += 50) {
    const batch = channelIds.slice(i, i + 50);
    const url = new URL("https://www.googleapis.com/youtube/v3/channels");
    url.searchParams.set("part", "statistics");
    url.searchParams.set("id", batch.join(","));
    url.searchParams.set("key", apiKey);
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) continue;
    const json = await res.json();
    for (const ch of json.items ?? []) {
      out.set(
        String(ch.id ?? ""),
        Number(ch.statistics?.subscriberCount) || 0,
      );
    }
  }
  return out;
}

// ── Pipeline ─────────────────────────────────────────────

async function fetchYouTube(category: VideoCategory): Promise<VideoItem[]> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return [];

  const queries = queriesForCategory(category);
  // Fewer per-query results for "all" to keep quota in check
  const perQuery = category === "all" ? 4 : 6;
  const publishedAfter = daysAgoISO(30);

  const idLists = await Promise.all(
    queries.map((q) => searchYouTube(q, apiKey, publishedAfter, perQuery)),
  );

  const seen = new Set<string>();
  const uniqueIds: string[] = [];
  for (const ids of idLists) {
    for (const id of ids) {
      if (!seen.has(id)) {
        seen.add(id);
        uniqueIds.push(id);
      }
    }
  }

  const stats = await fetchVideoStats(uniqueIds.slice(0, 50), apiKey);
  if (stats.length === 0) return [];

  const channelIds = Array.from(new Set(stats.map((s) => s.channelId).filter(Boolean)));
  const subsByChannel = await fetchChannelSubscribers(channelIds, apiKey);

  return stats.map((s) => ({
    id: s.id,
    title: s.title,
    url: `https://www.youtube.com/watch?v=${s.id}`,
    thumbnailUrl: s.thumbnailUrl,
    channelName: s.channelName,
    channelId: s.channelId,
    channelSubscriberCount: subsByChannel.get(s.channelId) ?? 0,
    isTrusted: TRUSTED_CHANNEL_IDS.has(s.channelId),
    viewCount: s.viewCount,
    likeCount: s.likeCount,
    publishedAt: s.publishedAt,
    description: s.description,
    durationSeconds: s.durationSeconds,
  }));
}

// ── Route ───────────────────────────────────────────────

function parseCategory(raw: string | null): VideoCategory {
  const v = (raw ?? "all").toLowerCase();
  return (VALID_CATEGORIES as string[]).includes(v)
    ? (v as VideoCategory)
    : "all";
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

  const { searchParams } = new URL(request.url);
  const category = parseCategory(searchParams.get("category"));

  const cacheKey = `videos:${category}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() < cached.expiry) {
    return NextResponse.json(cached.data);
  }

  try {
    const items = await fetchYouTube(category);
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
