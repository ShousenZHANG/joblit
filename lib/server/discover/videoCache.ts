import type { VideosResponse } from "@/app/(app)/discover/types";
import {
  readDiscoverCache,
  writeDiscoverCache,
} from "./discoverCache";

export {
  isFresh,
  isQuotaExceededError,
  buildCacheKey,
} from "./videoCacheHelpers";

interface VideoCacheEntry {
  key: string;
  payload: VideosResponse;
  fetchedAt: Date;
  expiresAt: Date;
}

/**
 * Read a cache row regardless of freshness. Used both by the fast path
 * (caller checks isFresh) and by quota-exhausted fallback that wants to
 * serve the last-known-good payload even if expired.
 */
export async function readCache(
  key: string,
): Promise<VideoCacheEntry | null> {
  return readDiscoverCache<VideosResponse>(key);
}

/**
 * Upsert a cache row with a TTL. `fetchedAt` captured from server clock at
 * write time — UI surfaces it as "Updated X ago" on stale fallback.
 */
export async function writeCache(
  key: string,
  payload: VideosResponse,
  ttlMs: number,
): Promise<void> {
  await writeDiscoverCache(key, payload, ttlMs);
}
