import { Prisma } from "@/lib/generated/prisma";
import { prisma } from "@/lib/server/prisma";

// Persistent last-known-good cache for the GitHub trending board.
//
// The daily-refresh claim/complete lease that used to live here went away with
// the cron: trending is now refreshed on demand by the first request that
// finds the entry expired (ADR-0005 superseded). What remains is a plain
// namespaced KV read/write over one table.

export interface DiscoverCacheEntry<T> {
  key: string;
  payload: T;
  fetchedAt: Date;
  expiresAt: Date;
}

export function buildRepoCacheKey(
  period: "weekly" | "monthly",
  clean: boolean,
): string {
  return `repos:${period}:${clean ? "clean" : "raw"}`;
}

/**
 * Fresh = not yet expired. Boundary equality counts as expired so the
 * fallover point is deterministic at the exact TTL tick.
 */
export function isFresh(entry: { expiresAt: Date }, nowMs: number): boolean {
  return entry.expiresAt.getTime() > nowMs;
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export async function readDiscoverCache<T>(
  key: string,
): Promise<DiscoverCacheEntry<T> | null> {
  const row = await prisma.discoverCache.findUnique({ where: { key } });
  if (!row) return null;
  return {
    key: row.key,
    payload: row.payload as T,
    fetchedAt: row.fetchedAt,
    expiresAt: row.expiresAt,
  };
}

export async function writeDiscoverCache<T>(
  key: string,
  payload: T,
  ttlMs: number,
  now = new Date(),
): Promise<void> {
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1) {
    throw new TypeError("Discover cache TTL must be a positive integer");
  }
  const expiresAt = new Date(now.getTime() + ttlMs);
  const json = asJson(payload);
  await prisma.discoverCache.upsert({
    where: { key },
    create: { key, payload: json, fetchedAt: now, expiresAt },
    update: { payload: json, fetchedAt: now, expiresAt },
  });
}
