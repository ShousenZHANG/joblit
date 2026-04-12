import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth";
import type { TrendingRepo, TrendingResponse } from "@/app/(app)/discover/types";

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const cache = new Map<string, { data: TrendingResponse; expiry: number }>();

// ── Primary: OSS Insight Trending API (real weekly/monthly trending by activity score) ──

async function fetchOSSInsight(
  period: "weekly" | "monthly",
): Promise<TrendingRepo[]> {
  const ossPeriod = period === "weekly" ? "past_week" : "past_month";
  const url = `https://api.ossinsight.io/v1/trends/repos?period=${ossPeriod}&limit=30`;

  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "Joblit-Discover/1.0" },
  });
  if (!res.ok) throw new Error(`OSS Insight API ${res.status}`);

  const json = await res.json();
  const rows: any[] = json?.data?.rows ?? [];

  return rows.map((row) => ({
    id: Number(row.repo_id),
    fullName: row.repo_name ?? "",
    description: row.description ?? null,
    url: `https://github.com/${row.repo_name}`,
    stars: Number(row.stars) || 0,
    forks: Number(row.forks) || 0,
    language: row.primary_language ?? null,
    topics: (row.collection_names ?? "")
      .split(",")
      .map((s: string) => s.trim())
      .filter(Boolean)
      .slice(0, 5),
    ownerAvatar: row.repo_name
      ? `https://github.com/${row.repo_name.split("/")[0]}.png?size=64`
      : "",
    pushedAt: new Date().toISOString(),
  }));
}

// ── Fallback: GitHub Search API ──

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

async function fetchGitHubSearch(
  period: "weekly" | "monthly",
): Promise<TrendingRepo[]> {
  const since = period === "weekly" ? daysAgo(7) : daysAgo(30);
  const url = new URL("https://api.github.com/search/repositories");
  url.searchParams.set("q", `created:>${since} stars:>50`);
  url.searchParams.set("sort", "stars");
  url.searchParams.set("order", "desc");
  url.searchParams.set("per_page", "30");

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "Joblit-Discover/1.0",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const res = await fetch(url.toString(), { headers });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${res.statusText}`);

  const json = await res.json();
  const items: any[] = json.items ?? [];

  return items.map((item) => ({
    id: item.id,
    fullName: item.full_name,
    description: item.description ?? null,
    url: item.html_url,
    stars: item.stargazers_count,
    forks: item.forks_count,
    language: item.language ?? null,
    topics: (item.topics ?? []).slice(0, 5),
    ownerAvatar: item.owner?.avatar_url ?? "",
    pushedAt: item.pushed_at,
  }));
}

// ── Route handler ──

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const period =
    searchParams.get("period") === "monthly" ? "monthly" : "weekly";

  const cacheKey = `trending:${period}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() < cached.expiry) {
    return NextResponse.json(cached.data);
  }

  try {
    // Primary: OSS Insight (real trending by activity score)
    // Fallback: GitHub Search API (recent high-star repos)
    let repos: TrendingRepo[];
    try {
      repos = await fetchOSSInsight(period);
    } catch {
      repos = await fetchGitHubSearch(period);
    }

    const response: TrendingResponse = {
      repos,
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
      err instanceof Error ? err.message : "Failed to fetch trending repos";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
