import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth";
import type { NewsItem, NewsResponse } from "@/app/(app)/discover/types";

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const TOKEN_BUFFER_MS = 60 * 1000; // Refresh token 60s before expiry

const cache = new Map<string, { data: NewsResponse; expiry: number }>();

// ── Reddit OAuth2 Token Management ──

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getRedditAccessToken(): Promise<string | null> {
  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;

  if (!clientId || !clientSecret) return null;

  // Return cached token if still valid
  if (cachedToken && Date.now() < cachedToken.expiresAt - TOKEN_BUFFER_MS) {
    return cachedToken.token;
  }

  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "User-Agent": "Joblit:discover:v1.0 (by /u/joblit-app)",
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    console.error(`Reddit OAuth failed: ${res.status}`);
    return null;
  }

  const json = await res.json();
  const token = json.access_token as string;
  const expiresIn = (json.expires_in as number) ?? 3600;

  cachedToken = {
    token,
    expiresAt: Date.now() + expiresIn * 1000,
  };

  return token;
}

// ── Reddit Data Fetching ──

const SUBREDDITS = ["ClaudeAI", "anthropic", "LocalLLaMA"];

async function fetchSubredditOAuth(
  sub: string,
  token: string,
): Promise<NewsItem[]> {
  const res = await fetch(
    `https://oauth.reddit.com/r/${sub}/top?t=week&limit=20`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "Joblit:discover:v1.0 (by /u/joblit-app)",
      },
      signal: AbortSignal.timeout(10000),
    },
  );

  if (!res.ok) {
    console.warn(`Reddit OAuth r/${sub} returned ${res.status}`);
    return [];
  }

  const json = await res.json();
  const posts: any[] = json?.data?.children ?? [];

  return posts
    .filter((child: any) => (child?.data?.score ?? 0) >= 10)
    .map(({ data: p }: any) => ({
      id: `reddit-${p.id}`,
      source: "reddit" as const,
      title: p.title ?? "",
      url:
        p.url_overridden_by_dest &&
        !p.url_overridden_by_dest.startsWith("https://www.reddit.com")
          ? p.url_overridden_by_dest
          : `https://www.reddit.com${p.permalink}`,
      score: p.score ?? 0,
      author: p.author ?? "",
      publishedAt: new Date((p.created_utc ?? 0) * 1000).toISOString(),
      commentCount: p.num_comments ?? 0,
      description: (p.selftext ?? "").slice(0, 200) || undefined,
    }));
}

/** Fallback: public JSON API (works locally, may fail on cloud IPs) */
async function fetchSubredditPublic(sub: string): Promise<NewsItem[]> {
  const res = await fetch(
    `https://www.reddit.com/r/${sub}/top.json?t=week&limit=20`,
    {
      headers: {
        "User-Agent": "Joblit:discover:v1.0 (by /u/joblit-app)",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10000),
    },
  );

  if (!res.ok) return [];

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) return [];

  const json = await res.json();
  const posts: any[] = json?.data?.children ?? [];

  return posts
    .filter((child: any) => (child?.data?.score ?? 0) >= 10)
    .map(({ data: p }: any) => ({
      id: `reddit-${p.id}`,
      source: "reddit" as const,
      title: p.title ?? "",
      url:
        p.url_overridden_by_dest &&
        !p.url_overridden_by_dest.startsWith("https://www.reddit.com")
          ? p.url_overridden_by_dest
          : `https://www.reddit.com${p.permalink}`,
      score: p.score ?? 0,
      author: p.author ?? "",
      publishedAt: new Date((p.created_utc ?? 0) * 1000).toISOString(),
      commentCount: p.num_comments ?? 0,
      description: (p.selftext ?? "").slice(0, 200) || undefined,
    }));
}

async function fetchAllReddit(): Promise<NewsItem[]> {
  const token = await getRedditAccessToken();

  // Use OAuth if configured, otherwise fall back to public API
  const fetcher = token
    ? (sub: string) => fetchSubredditOAuth(sub, token)
    : fetchSubredditPublic;

  const results = await Promise.allSettled(SUBREDDITS.map(fetcher));

  const items: NewsItem[] = [];
  const seenUrls = new Set<string>();

  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const item of result.value) {
      if (!seenUrls.has(item.url)) {
        seenUrls.add(item.url);
        items.push(item);
      }
    }
  }

  return items.sort((a, b) => b.score - a.score);
}

// ── Route Handler ──

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cacheKey = "news:reddit";
  const cached = cache.get(cacheKey);
  if (cached && Date.now() < cached.expiry) {
    return NextResponse.json(cached.data);
  }

  try {
    const items = await fetchAllReddit();
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
