import { NextResponse } from "next/server";
import { withSessionRoute } from "@/lib/server/api/routeHandler";
import type { TrendingResponse } from "@/app/(app)/discover/types";
import {
  fetchTrendingRepos,
  filterTrendingNoise,
  type TrendingPeriod,
} from "@/lib/server/discover/githubTrending";
import { reportError } from "@/lib/server/observability/errorReporter";
import {
  buildRepoCacheKey,
  readDiscoverCache,
  writeDiscoverCache,
} from "@/lib/server/discover/discoverCache";
import { isFresh } from "@/lib/server/discover/videoCacheHelpers";

// Slightly longer than the daily cron cadence. Serverless cold starts retain
// the same DB-backed last-known-good payload instead of resetting an in-memory
// Map and hitting GitHub again.
const CACHE_TTL_MS = 25 * 60 * 60 * 1000;

export async function GET(request: Request) {
  return withSessionRoute(async () => {

    const { searchParams } = new URL(request.url);
    const period: TrendingPeriod =
      searchParams.get("period") === "monthly" ? "monthly" : "weekly";
    // Optional noise filter (default off = official parity). `clean=1` drops
    // mostly-CJK / awesome-list / interview-prep rows from the official list.
    const clean = searchParams.get("clean") === "1";

    const cacheKey = buildRepoCacheKey(period, clean);
    const existing = await readDiscoverCache<TrendingResponse>(cacheKey).catch(
      () => null,
    );
    if (existing && isFresh(existing, Date.now())) {
      return NextResponse.json({
        ...existing.payload,
        cached: true,
        fetchedAt: existing.fetchedAt.toISOString(),
      } satisfies TrendingResponse);
    }

    try {
      // Scrapes github.com/trending?since={period} for exact parity with the
      // official leaderboard (no public API exists; see githubTrending.ts).
      const fetched = await fetchTrendingRepos(period);
      const cleanRepos = filterTrendingNoise(fetched);
      const fetchedAt = new Date();
      const rawResponse: TrendingResponse = {
        repos: fetched,
        cached: false,
        fetchedAt: fetchedAt.toISOString(),
      };
      const cleanResponse: TrendingResponse = {
        repos: cleanRepos,
        cached: false,
        fetchedAt: fetchedAt.toISOString(),
      };
      await Promise.all([
        writeDiscoverCache(
          buildRepoCacheKey(period, false),
          rawResponse,
          CACHE_TTL_MS,
        ),
        writeDiscoverCache(
          buildRepoCacheKey(period, true),
          cleanResponse,
          CACHE_TTL_MS,
        ),
      ]).catch(() => {
        // Cache persistence is an availability optimization. A live upstream
        // result remains valid even if the DB cache write is temporarily down.
      });
      const response = clean ? cleanResponse : rawResponse;
      return NextResponse.json(response);
    } catch (err) {
      // Stale-while-error survives cold starts because the fallback is durable.
      if (existing) {
        return NextResponse.json({
          ...existing.payload,
          cached: true,
          stale: true,
          fetchedAt: existing.fetchedAt.toISOString(),
        } satisfies TrendingResponse);
      }
      // Upstream error text stays server-side; the client gets a stable code.
      reportError(err, { scope: "discover.trending" });
      return NextResponse.json({ error: "TRENDING_UNAVAILABLE" }, { status: 502 });
    }
  });
}
