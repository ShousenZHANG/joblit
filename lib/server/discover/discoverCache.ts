import { randomUUID } from "node:crypto";
import { Prisma } from "@/lib/generated/prisma";
import { prisma } from "@/lib/server/prisma";

const DAILY_RESULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

export interface DiscoverCacheEntry<T> {
  key: string;
  payload: T;
  fetchedAt: Date;
  expiresAt: Date;
}

export type DailyDiscoverClaim =
  | {
      claimed: true;
      runKey: string;
      ownerToken: string;
    }
  | {
      claimed: false;
      runKey: string;
      previous: unknown;
    };

export function buildRepoCacheKey(
  period: "weekly" | "monthly",
  clean: boolean,
): string {
  return `repos:${period}:${clean ? "clean" : "raw"}`;
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function isUniqueConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

export async function readDiscoverCache<T>(
  key: string,
): Promise<DiscoverCacheEntry<T> | null> {
  const row = await prisma.discoverVideoCache.findUnique({ where: { key } });
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
  await prisma.discoverVideoCache.upsert({
    where: { key },
    create: { key, payload: json, fetchedAt: now, expiresAt },
    update: { payload: json, fetchedAt: now, expiresAt },
  });
}

/**
 * Claim one refresh per UTC date. `create` is the first atomic boundary.
 * A duplicate can only reclaim the row after the short execution lease
 * expires, which recovers a crashed invocation without allowing concurrent
 * YouTube quota consumption.
 */
export async function claimDailyDiscoverRefresh(
  now = new Date(),
  leaseMs = 55_000,
): Promise<DailyDiscoverClaim> {
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1) {
    throw new TypeError("Discover refresh lease must be a positive integer");
  }
  const runKey = `discover-refresh:${now.toISOString().slice(0, 10)}`;
  const ownerToken = randomUUID();
  const runningPayload = {
    status: "running",
    ownerToken,
    startedAt: now.toISOString(),
  };
  const leaseExpiresAt = new Date(now.getTime() + leaseMs);

  try {
    await prisma.discoverVideoCache.create({
      data: {
        key: runKey,
        payload: asJson(runningPayload),
        fetchedAt: now,
        expiresAt: leaseExpiresAt,
      },
    });
    return { claimed: true, runKey, ownerToken };
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
  }

  const reclaimed = await prisma.discoverVideoCache.updateMany({
    where: {
      key: runKey,
      expiresAt: { lte: now },
    },
    data: {
      payload: asJson(runningPayload),
      fetchedAt: now,
      expiresAt: leaseExpiresAt,
    },
  });
  if (reclaimed.count === 1) {
    return { claimed: true, runKey, ownerToken };
  }

  const existing = await readDiscoverCache<unknown>(runKey);
  return {
    claimed: false,
    runKey,
    previous: existing?.payload ?? { status: "running" },
  };
}

export async function completeDailyDiscoverRefresh(
  runKey: string,
  ownerToken: string,
  summary: unknown,
  now = new Date(),
): Promise<boolean> {
  const completed = await prisma.discoverVideoCache.updateMany({
    where: {
      key: runKey,
      payload: {
        path: ["ownerToken"],
        equals: ownerToken,
      },
    },
    data: {
      payload: asJson(summary),
      fetchedAt: now,
      expiresAt: new Date(now.getTime() + DAILY_RESULT_RETENTION_MS),
    },
  });
  return completed.count === 1;
}
