import { prisma } from "@/lib/server/prisma";
import type { VideosResponse } from "@/app/(app)/discover/types";

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
  const row = await prisma.discoverVideoCache.findUnique({ where: { key } });
  if (!row) return null;
  return {
    key: row.key,
    payload: row.payload as unknown as VideosResponse,
    fetchedAt: row.fetchedAt,
    expiresAt: row.expiresAt,
  };
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
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);
  await prisma.discoverVideoCache.upsert({
    where: { key },
    create: {
      key,
      payload: payload as unknown as object,
      fetchedAt: now,
      expiresAt,
    },
    update: {
      payload: payload as unknown as object,
      fetchedAt: now,
      expiresAt,
    },
  });
}
