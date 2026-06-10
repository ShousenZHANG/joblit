import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth";
import type { TrendingResponse } from "@/app/(app)/discover/types";
import {
  fetchTrendingRepos,
  filterTrendingNoise,
  type TrendingPeriod,
} from "@/lib/server/discover/githubTrending";
import { reportError } from "@/lib/server/observability/errorReporter";

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const cache = new Map<string, { data: TrendingResponse; expiry: number }>();
// Last-known-good payload per cache key, kept indefinitely (until replaced by a
// successful fetch). Powers the stale-while-error fallback: GitHub markup
// changes / rate limits / outages degrade to the previous good list instead of
// a hard 502, so the Discover feed never goes blank on a transient failure.
const lastGood = new Map<string, TrendingResponse>();

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const period: TrendingPeriod =
    searchParams.get("period") === "monthly" ? "monthly" : "weekly";
  // Optional noise filter (default off = official parity). `clean=1` drops
  // mostly-CJK / awesome-list / interview-prep rows from the official list.
  const clean = searchParams.get("clean") === "1";

  const cacheKey = `trending:${period}:${clean ? "clean" : "raw"}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() < cached.expiry) {
    return NextResponse.json(cached.data);
  }

  try {
    // Scrapes github.com/trending?since={period} for exact parity with the
    // official leaderboard (no public API exists; see githubTrending.ts).
    const fetched = await fetchTrendingRepos(period);
    const repos = clean ? filterTrendingNoise(fetched) : fetched;

    const response: TrendingResponse = {
      repos,
      cached: false,
      fetchedAt: new Date().toISOString(),
    };
    const cachedResponse: TrendingResponse = { ...response, cached: true };
    cache.set(cacheKey, { data: cachedResponse, expiry: Date.now() + CACHE_TTL_MS });
    lastGood.set(cacheKey, cachedResponse);
    return NextResponse.json(response);
  } catch (err) {
    // Stale-while-error: serve the last good payload (even past its TTL) so a
    // transient upstream failure never blanks the feed. Only hard-fail when we
    // have never successfully fetched this key.
    const fallback = lastGood.get(cacheKey);
    if (fallback) {
      return NextResponse.json({ ...fallback, stale: true });
    }
    // Upstream error text stays server-side; the client gets a stable code.
    reportError(err, { scope: "discover.trending" });
    return NextResponse.json({ error: "TRENDING_UNAVAILABLE" }, { status: 502 });
  }
}
