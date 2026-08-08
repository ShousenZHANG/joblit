/**
 * GitHub Trending contract — shared by the scraper, the API route, and the
 * nav popover that renders it.
 *
 * Lives in lib/shared (not next to a page) because the Discover workspace it
 * used to belong to is gone: trending survives only as a small ambient panel
 * in the app nav, so its types have no page to be co-located with.
 */

export interface TrendingRepo {
  id: number;
  fullName: string;
  description: string | null;
  url: string;
  stars: number;
  forks: number;
  /** Stars gained in the selected period (matches github.com/trending). */
  starsGained: number;
  language: string | null;
  topics: string[];
  ownerAvatar: string;
  pushedAt: string;
}

export interface TrendingResponse {
  repos: TrendingRepo[];
  cached: boolean;
  fetchedAt: string;
  /** True when a live fetch failed and we served the last-known-good payload
   *  from cache regardless of its TTL (resilience fallback). */
  stale?: boolean;
}

/** Format large numbers: 1000 → "1k", 1200 → "1.2k", 500 → "500". */
export function formatCount(n: number): string {
  if (n >= 1_000) {
    const val = n / 1000;
    return `${Number.isInteger(val) ? val : val.toFixed(1)}k`;
  }
  return String(n);
}
