import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth";
import type { TrendingRepo, TrendingResponse } from "@/app/(app)/discover/types";

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const cache = new Map<
  string,
  { data: TrendingResponse; expiry: number }
>();

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

async function fetchTrending(
  period: "weekly" | "monthly",
): Promise<TrendingRepo[]> {
  const since = period === "weekly" ? daysAgo(7) : daysAgo(30);
  const url = new URL("https://api.github.com/search/repositories");
  url.searchParams.set("q", `stars:>50 pushed:>${since}`);
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
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}: ${res.statusText}`);
  }

  const json = await res.json();
  const items: unknown[] = json.items ?? [];

  return items.map((item: any) => ({
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
    const repos = await fetchTrending(period);
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
