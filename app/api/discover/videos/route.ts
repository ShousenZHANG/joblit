import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth";
import type {
  VideoItem,
  VideoCategory,
  VideosResponse,
} from "@/app/(app)/discover/types";
import trustedChannelsConfig from "@/lib/shared/trustedChannels.config.json";

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

// ── Category query banks + relevance keyword sets ─────────

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

/**
 * Keywords the title+description must plausibly contain for a video to be
 * "relevant" to each category. Used for secondary relevance filtering —
 * YouTube relevance ranking is loose, this catches obvious off-topic matches.
 */
const CATEGORY_KEYWORDS: Record<Exclude<VideoCategory, "all">, string[]> = {
  claude: ["claude", "anthropic", "sonnet", "opus", "haiku"],
  anthropic: ["anthropic", "claude", "constitutional ai"],
  rag: [
    "rag",
    "retrieval",
    "vector",
    "embedding",
    "chroma",
    "pinecone",
    "pgvector",
    "qdrant",
    "weaviate",
  ],
  agents: [
    "agent",
    "agentic",
    "autonomous",
    "tool use",
    "function call",
    "langgraph",
    "crewai",
    "autogen",
  ],
  mcp: ["mcp", "model context protocol"],
  harness: ["harness", "coding agent", "claude code", "cursor", "cline", "aider"],
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

// ── Trusted channel lookup ────────────────────────────────

interface TrustedChannel {
  id: string;
  name: string;
  tier: 1 | 2 | 3;
  expertiseTags: string[];
}

const TRUSTED_CHANNEL_MAP: Map<string, TrustedChannel> = (() => {
  const map = new Map<string, TrustedChannel>();
  const list =
    (trustedChannelsConfig as { channels?: TrustedChannel[] }).channels ?? [];
  for (const ch of list) map.set(ch.id, ch);
  return map;
})();

// ── Relevance scoring ─────────────────────────────────────

/**
 * Keyword-overlap relevance score (0-1). Counts distinct category keywords
 * found in title+description; saturating at 3 matches = 1.0.
 */
function scoreRelevance(
  text: string,
  category: VideoCategory,
): number {
  if (category === "all") {
    // For "all", take max across all category keyword sets so a video
    // clearly about one topic scores well.
    let best = 0;
    for (const cat of Object.keys(CATEGORY_KEYWORDS) as Exclude<
      VideoCategory,
      "all"
    >[]) {
      best = Math.max(best, scoreRelevance(text, cat));
    }
    return best;
  }
  const keywords = CATEGORY_KEYWORDS[category];
  const haystack = text.toLowerCase();
  let hits = 0;
  for (const kw of keywords) {
    if (haystack.includes(kw)) hits++;
    if (hits >= 3) break;
  }
  return Math.min(hits / 3, 1);
}

// ── YouTube API helpers ───────────────────────────────────

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
  url.searchParams.set("videoDuration", "medium");
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

function parseISODuration(iso: string): number {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (
    Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)
  );
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
    description: item.snippet?.description ?? "",
    durationSeconds: parseISODuration(item.contentDetails?.duration ?? ""),
  }));
}

async function fetchChannelSubscribers(
  channelIds: string[],
  apiKey: string,
): Promise<Map<string, number>> {
  if (channelIds.length === 0) return new Map();
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

// ── Pipeline ──────────────────────────────────────────────

const RELEVANCE_THRESHOLD = 0.33; // need at least 1 category keyword hit

async function fetchYouTube(category: VideoCategory): Promise<VideoItem[]> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return [];

  const queries = queriesForCategory(category);
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

  const channelIds = Array.from(
    new Set(stats.map((s) => s.channelId).filter(Boolean)),
  );
  const subsByChannel = await fetchChannelSubscribers(channelIds, apiKey);

  const enriched: VideoItem[] = stats.map((s) => {
    const trusted = TRUSTED_CHANNEL_MAP.get(s.channelId);
    const relevance = scoreRelevance(
      `${s.title} ${s.description}`,
      category,
    );
    return {
      id: s.id,
      title: s.title,
      url: `https://www.youtube.com/watch?v=${s.id}`,
      thumbnailUrl: s.thumbnailUrl,
      channelName: s.channelName,
      channelId: s.channelId,
      channelSubscriberCount: subsByChannel.get(s.channelId) ?? 0,
      isTrusted: Boolean(trusted),
      trustTier: (trusted?.tier ?? 0) as 0 | 1 | 2 | 3,
      expertiseTags: trusted?.expertiseTags ?? [],
      viewCount: s.viewCount,
      likeCount: s.likeCount,
      publishedAt: s.publishedAt,
      description: s.description.slice(0, 300),
      durationSeconds: s.durationSeconds,
      relevanceScore: relevance,
    };
  });

  // Secondary relevance filter — drop clearly off-topic results.
  // Trusted channels get a grace pass (still filter but with looser bar) so
  // high-authority creators don't get pruned over keyword mismatch.
  return enriched.filter((v) => {
    const threshold = v.isTrusted ? RELEVANCE_THRESHOLD * 0.5 : RELEVANCE_THRESHOLD;
    return v.relevanceScore >= threshold;
  });
}

// ── Route ─────────────────────────────────────────────────

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
