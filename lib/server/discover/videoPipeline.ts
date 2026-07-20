// YouTube fetch pipeline: search → videos.list → channels.list → enrich.
// Extracted from the API route so ranking and quota-sensitive behavior remain
// testable without coupling them to the request handler.

import type {
  VideoItem,
  VideoCategory,
  VideoSort,
  VideoTimeWindow,
} from "@/app/(app)/discover/types";
import { safeOutboundFetch } from "@/lib/server/net/safeFetch";
import trustedChannelsConfig from "@/lib/shared/trustedChannels.config.json";

// ── Quota accounting ──────────────────────────────────────
//
// YouTube Data API v3 per-call cost (units):
//   search.list    = 100   ← dominates spend
//   videos.list    =   1
//   channels.list  =   1
//
// Free tier is 10,000 units/day. Worst-case refresh-cycle budget per day:
//   "all"          × 2 windows × 7 queries × 100 =  1,400
//   7 categories   × 2 windows × 4 queries × 100 =  5,600
//   videos.list + channels.list overhead per key  =    ~30
//   -------------------------------------------------------
//   Total ≈ 7,030 units/day for one daily refresh cycle.
// One full cycle per day fits comfortably; two cycles is tight but viable.

const QUERIES_PER_CATEGORY = 4; // reduced from 6 to stay under quota
const VIDEO_ID_LIMIT = 50; // videos.list caps at 50 IDs per call
const MIN_VIDEO_SECONDS = 90; // avoid Shorts dominating "most viewed"
const YOUTUBE_OUTBOUND_POLICY = {
  allowedHosts: ["www.googleapis.com"],
  timeoutMs: 8_000,
  maxResponseBytes: 1024 * 1024,
  maxRedirects: 0,
} as const;

// ── Category query banks ──────────────────────────────────

const CATEGORY_QUERIES: Record<
  Exclude<VideoCategory, "all">,
  string[]
> = {
  codex: [
    "OpenAI Codex coding agent",
    "ChatGPT Codex tutorial",
    "Codex CLI programming",
    "OpenAI Codex software engineering",
  ],
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
    // No year in queries — publishedAfter already bounds freshness, and a
    // hardcoded year silently rots the query as the calendar moves on.
    "AI agent building",
    "agentic workflow",
    "autonomous AI agent",
    "agent framework tutorial",
  ],
  "agent-skills": [
    "Claude Agent Skills",
    "Anthropic agent skills",
    "Model Context Protocol",
    "MCP server tutorial",
  ],
  "harness-engineering": [
    "AI harness engineering",
    "agent harness",
    "Claude Code harness",
    "agentic coding workflow",
  ],
};

// Titles+descriptions must plausibly contain one of these for a video to
// be scored as "relevant" to the category (soft signal — no hard filter).
const CATEGORY_KEYWORDS: Record<Exclude<VideoCategory, "all">, string[]> = {
  codex: [
    "codex",
    "openai codex",
    "chatgpt codex",
    "codex cli",
    "coding agent",
    "software engineering agent",
    "code agent",
    "terminal agent",
    "pull request",
  ],
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
  "agent-skills": [
    "skill",
    "mcp",
    "model context protocol",
    "tool use",
    "function call",
    "claude",
    "agent",
  ],
  "harness-engineering": [
    "harness",
    "coding agent",
    "claude code",
    "cursor",
    "cline",
    "aider",
    "agentic",
    "agent workflow",
  ],
};

/**
 * Which queries to run for a category. "all" takes the single strongest
 * query from each sub-category (7 total) instead of flattening every
 * query (was 25) — a 72% quota reduction for the most common request.
 */
export function queriesForCategory(cat: VideoCategory): string[] {
  if (cat === "all") {
    const out: string[] = [];
    for (const list of Object.values(CATEGORY_QUERIES)) {
      if (list.length > 0) out.push(list[0]);
    }
    return out;
  }
  return CATEGORY_QUERIES[cat].slice(0, QUERIES_PER_CATEGORY);
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

// ── Pure scoring ──────────────────────────────────────────

export function scoreRelevance(
  text: string,
  category: VideoCategory,
): number {
  if (category === "all") {
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

// ── Trending composite quality score ─────────────────────
//
// The default "trending" view previously returned videos in raw YouTube
// search order — relevanceScore and trustTier were computed but never used to
// rank, so off-topic / low-engagement / untrusted videos could top the feed.
// This composite ranks by the signals that actually mean "worth watching":
// topical relevance, channel trust, engagement, and recency.

export interface ScorableVideo {
  relevanceScore: number;
  trustTier: 0 | 1 | 2 | 3;
  viewCount: number;
  likeCount: number;
  publishedAt: string;
}

export function trustScore(tier: 0 | 1 | 2 | 3): number {
  return tier === 1 ? 1 : tier === 2 ? 0.7 : tier === 3 ? 0.4 : 0;
}

// log-scaled views (≈1.0 at 1M) blended with like ratio so a small but highly
// engaging video isn't buried under a viral-but-shallow one.
export function engagementScore(views: number, likes: number): number {
  const viewPart = Math.min(Math.log10(Math.max(0, views) + 1) / 6, 1);
  const likeRatio = views > 0 ? Math.min(likes / views, 0.1) / 0.1 : 0;
  return 0.7 * viewPart + 0.3 * likeRatio;
}

export function recencyScore(publishedAt: string, windowDays: number): number {
  const ts = Date.parse(publishedAt);
  if (Number.isNaN(ts)) return 0;
  const ageDays = (Date.now() - ts) / 86_400_000;
  if (ageDays <= 0) return 1;
  return Math.max(0, 1 - ageDays / Math.max(1, windowDays));
}

export function computeTrendingScore(
  v: ScorableVideo,
  windowDays: number,
): number {
  return (
    0.4 * v.relevanceScore +
    0.25 * trustScore(v.trustTier) +
    0.25 * engagementScore(v.viewCount, v.likeCount) +
    0.1 * recencyScore(v.publishedAt, windowDays)
  );
}

// ── YouTube API calls ─────────────────────────────────────

function daysAgoISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

type YouTubeSearchOrder = "date" | "relevance" | "viewCount";

export function searchOrderForSort(sort: VideoSort): YouTubeSearchOrder {
  if (sort === "latest") return "date";
  if (sort === "most_viewed") return "viewCount";
  return "relevance";
}

async function searchYouTube(
  query: string,
  apiKey: string,
  publishedAfter: string,
  maxResults: number,
  order: YouTubeSearchOrder,
): Promise<string[]> {
  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("q", query);
  url.searchParams.set("type", "video");
  url.searchParams.set("order", order);
  url.searchParams.set("publishedAfter", publishedAfter);
  url.searchParams.set("maxResults", String(maxResults));
  url.searchParams.set("relevanceLanguage", "en");
  // No videoDuration filter: "medium" (4–20 min) was silently dropping the
  // highest-value content in this space — conference keynotes, Karpathy-style
  // lectures, deep-dive courses are all >20 min. Shorts are still excluded by
  // the MIN_VIDEO_SECONDS post-filter, and the ranking's duration sweet-spot
  // keeps practical-length videos competitive without amputating long-form.
  url.searchParams.set("key", apiKey);

  const res = await safeOutboundFetch(url, {}, YOUTUBE_OUTBOUND_POLICY);
  if (res.status === 403) {
    const err = new Error("YouTube search 403") as Error & { status: number };
    err.status = 403;
    throw err;
  }
  if (!res.ok) return [];
  const json = (await res.json()) as {
    items?: { id?: { videoId?: string } }[];
  };
  return (json.items ?? [])
    .map((item) => item.id?.videoId)
    .filter((id): id is string => typeof id === "string");
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
  const res = await safeOutboundFetch(url, {}, YOUTUBE_OUTBOUND_POLICY);
  if (res.status === 403) {
    const err = new Error("YouTube videos 403") as Error & { status: number };
    err.status = 403;
    throw err;
  }
  if (!res.ok) throw new Error(`YouTube Videos API ${res.status}`);
  const json = (await res.json()) as {
    items?: Array<{
      id?: string;
      snippet?: {
        title?: string;
        thumbnails?: {
          medium?: { url?: string };
          default?: { url?: string };
        };
        channelTitle?: string;
        channelId?: string;
        publishedAt?: string;
        description?: string;
      };
      statistics?: { viewCount?: string; likeCount?: string };
      contentDetails?: { duration?: string };
    }>;
  };
  return (json.items ?? []).map((item) => ({
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
    const res = await safeOutboundFetch(url, {}, YOUTUBE_OUTBOUND_POLICY);
    if (res.status === 403) {
      const err = new Error("YouTube channels 403") as Error & {
        status: number;
      };
      err.status = 403;
      throw err;
    }
    if (!res.ok) continue;
    const json = (await res.json()) as {
      items?: Array<{ id?: string; statistics?: { subscriberCount?: string } }>;
    };
    for (const ch of json.items ?? []) {
      out.set(
        String(ch.id ?? ""),
        Number(ch.statistics?.subscriberCount) || 0,
      );
    }
  }
  return out;
}

// ── Pipeline entry ────────────────────────────────────────

export async function fetchVideosFromYouTube(
  category: VideoCategory,
  timeWindow: VideoTimeWindow,
  apiKey: string,
  sort: VideoSort = "trending",
): Promise<VideoItem[]> {
  const queries = queriesForCategory(category);
  const perQuery = category === "all" ? 4 : 6;
  const publishedAfter = daysAgoISO(timeWindow === "week" ? 7 : 30);
  const order = searchOrderForSort(sort);

  // Sequential — parallel bursts can trigger rateLimitExceeded even when
  // the day budget is nowhere near drained.
  const idLists: string[][] = [];
  for (const q of queries) {
    idLists.push(
      await searchYouTube(q, apiKey, publishedAfter, perQuery, order),
    );
  }

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

  const stats = await fetchVideoStats(
    uniqueIds.slice(0, VIDEO_ID_LIMIT),
    apiKey,
  );
  if (stats.length === 0) return [];

  const channelIds = Array.from(
    new Set(stats.map((s) => s.channelId).filter(Boolean)),
  );
  const subsByChannel = await fetchChannelSubscribers(channelIds, apiKey);

  const videos = stats
    .filter(
      (s) =>
        s.durationSeconds === 0 || s.durationSeconds >= MIN_VIDEO_SECONDS,
    )
    .map((s) => {
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

  if (sort === "latest") {
    return videos.sort(
      (a, b) =>
        new Date(b.publishedAt).getTime() -
        new Date(a.publishedAt).getTime(),
    );
  }
  if (sort === "most_viewed") {
    return videos.sort(
      (a, b) =>
        b.viewCount - a.viewCount ||
        new Date(b.publishedAt).getTime() -
          new Date(a.publishedAt).getTime(),
    );
  }
  // Default "trending": rank by the composite quality score so the feed leads
  // with relevant, trusted, well-engaged, recent videos instead of raw search
  // order. Cache the score to avoid recomputing in the comparator.
  const windowDays = timeWindow === "week" ? 7 : 30;
  const scored = videos.map((v) => ({
    v,
    score: computeTrendingScore(v, windowDays),
  }));
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      new Date(b.v.publishedAt).getTime() - new Date(a.v.publishedAt).getTime(),
  );
  return scored.map((s) => s.v);
}
