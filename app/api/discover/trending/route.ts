import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth";
import type { TrendingResponse } from "@/app/(app)/discover/types";
import {
  fetchTrendingRepos,
  type TrendingPeriod,
} from "@/lib/server/discover/githubTrending";

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const cache = new Map<string, { data: TrendingResponse; expiry: number }>();

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const period: TrendingPeriod =
    searchParams.get("period") === "monthly" ? "monthly" : "weekly";

  const cacheKey = `trending:${period}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() < cached.expiry) {
    return NextResponse.json(cached.data);
  }

  try {
    // Scrapes github.com/trending?since={period} for exact parity with the
    // official leaderboard (no public API exists; see githubTrending.ts).
    const repos = await fetchTrendingRepos(period);

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
