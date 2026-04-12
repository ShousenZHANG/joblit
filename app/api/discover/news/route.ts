import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth";
import type { NewsItem, NewsResponse } from "@/app/(app)/discover/types";
import { runPipeline, type DiscoverItem } from "@/lib/server/discover/pipeline";
import type { RankedStream } from "@/lib/server/discover/fusion";

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

const cache = new Map<string, { data: NewsResponse; expiry: number }>();

// Focused on Claude/Anthropic/RAG ecosystem
const AI_KEYWORDS =
  /\b(claude|anthropic|rag|retrieval.augmented|harness|agent|agentic|mcp|tool.use|function.calling|prompt.engineering|llm|langchain|llamaindex|vector.database|embedding|fine.?tun|context.window)/i;

const MIN_SCORE_THRESHOLD = 20; // Filter out low-engagement posts

// ── Hacker News ──

interface HNItem {
  id: number;
  title: string;
  url?: string;
  score: number;
  by: string;
  time: number;
  descendants?: number;
}

async function fetchHN(): Promise<DiscoverItem[]> {
  const idsRes = await fetch(
    "https://hacker-news.firebaseio.com/v0/topstories.json",
    { next: { revalidate: 1800 } },
  );
  if (!idsRes.ok) return [];
  const ids: number[] = await idsRes.json();

  const top50 = ids.slice(0, 50);
  const items = await Promise.all(
    top50.map(async (id): Promise<HNItem | null> => {
      try {
        const r = await fetch(
          `https://hacker-news.firebaseio.com/v0/item/${id}.json`,
        );
        if (!r.ok) return null;
        return r.json();
      } catch {
        return null;
      }
    }),
  );

  return items
    .filter(
      (it): it is HNItem =>
        it !== null &&
        AI_KEYWORDS.test(it.title) &&
        it.score >= MIN_SCORE_THRESHOLD,
    )
    .slice(0, 20)
    .map((it) => ({
      id: `hn-${it.id}`,
      source: "hn",
      title: it.title,
      url: it.url ?? `https://news.ycombinator.com/item?id=${it.id}`,
      body: it.title,
      author: it.by,
      publishedAt: new Date(it.time * 1000).toISOString(),
      engagement: { score: it.score, comments: it.descendants ?? 0 },
      relevance: 0.8,
      tags: [],
    }));
}

// ── Dev.to ──

interface DevToArticle {
  id: number;
  title: string;
  description: string;
  url: string;
  cover_image: string | null;
  user: { name: string };
  published_at: string;
  positive_reactions_count: number;
  comments_count: number;
  tag_list: string[];
}

async function fetchDevTo(): Promise<DiscoverItem[]> {
  const res = await fetch(
    "https://dev.to/api/articles?tag=ai&top=7&per_page=20",
    {
      headers: { "User-Agent": "Joblit-Discover/1.0" },
      next: { revalidate: 1800 },
    },
  );
  if (!res.ok) return [];
  const articles: DevToArticle[] = await res.json();

  return articles.map((a) => ({
    id: `devto-${a.id}`,
    source: "devto",
    title: a.title,
    url: a.url,
    body: a.description,
    author: a.user.name,
    publishedAt: a.published_at,
    engagement: {
      score: a.positive_reactions_count,
      comments: a.comments_count,
    },
    relevance: 0.7,
    tags: (a.tag_list ?? []).slice(0, 5),
  }));
}

// ── Reddit (free public JSON API) ──

const SUBREDDITS = ["ClaudeAI", "anthropic", "LocalLLaMA", "artificial"];

async function fetchReddit(): Promise<DiscoverItem[]> {
  const results: DiscoverItem[] = [];

  for (const sub of SUBREDDITS) {
    try {
      const res = await fetch(
        `https://www.reddit.com/r/${sub}/top.json?t=week&limit=15`,
        {
          headers: { "User-Agent": "Joblit-Discover/1.0 (by /u/joblit-bot)" },
          signal: AbortSignal.timeout(8000),
        },
      );
      if (!res.ok) continue;
      const json = await res.json();
      const posts: any[] = json?.data?.children ?? [];

      for (const { data: p } of posts) {
        results.push({
          id: `reddit-${p.id}`,
          source: "reddit",
          title: p.title,
          url: p.url?.startsWith("https://www.reddit.com")
            ? `https://www.reddit.com${p.permalink}`
            : p.url ?? `https://www.reddit.com${p.permalink}`,
          body: (p.selftext ?? "").slice(0, 300),
          author: p.author ?? "",
          publishedAt: new Date((p.created_utc ?? 0) * 1000).toISOString(),
          engagement: { score: p.score ?? 0, comments: p.num_comments ?? 0 },
          relevance: 0.75,
          tags: [],
        });
      }
    } catch {
      // Skip failed subreddit, continue with others
    }
  }

  return results;
}

/** Convert pipeline Candidate back to the NewsItem format the frontend expects. */
function candidateToNewsItem(
  c: ReturnType<typeof runPipeline>["candidates"][number],
): NewsItem {
  const primarySource = c.sources[0] as "hn" | "devto" | "reddit";
  const bestItem = c.items[0];
  return {
    id: bestItem?.id ?? c.key,
    source: primarySource,
    title: c.title,
    url: c.url,
    score: Math.round(c.finalScore),
    author: c.author,
    publishedAt: c.publishedAt,
    commentCount: Math.max(
      ...c.items.map((it) => it.engagement.comments),
      0,
    ),
    description: c.body || undefined,
    // Mark cross-source items
    ...(c.sources.length > 1
      ? { crossSource: c.sources }
      : {}),
  };
}

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const source = searchParams.get("source") ?? "all";

  const cacheKey = `news:${source}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() < cached.expiry) {
    return NextResponse.json(cached.data);
  }

  try {
    // Parallel fetch from available sources
    const fetchers: { key: string; fn: Promise<DiscoverItem[]> }[] = [];
    if (source === "all" || source === "hn")
      fetchers.push({ key: "hn", fn: fetchHN() });
    if (source === "all" || source === "devto")
      fetchers.push({ key: "devto", fn: fetchDevTo() });
    if (source === "all" || source === "reddit")
      fetchers.push({ key: "reddit", fn: fetchReddit() });

    const results = await Promise.all(fetchers.map((f) => f.fn));

    // Build ranked streams for the pipeline
    const streams: RankedStream[] = fetchers.map((f, i) => ({
      label: "primary",
      source: f.key,
      weight: 1.0,
      items: results[i],
    }));

    // Run the full pipeline: dedup → RRF fusion → scoring → author cap → clustering
    const { candidates } = runPipeline({
      streams,
      sourceWeights: { hn: 1.0, devto: 1.0, reddit: 1.0 },
      authorCap: 2,
      minSourceSlots: 2,
    });

    const items = candidates.map(candidateToNewsItem);

    const response: NewsResponse = {
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
      err instanceof Error ? err.message : "Failed to fetch news";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
