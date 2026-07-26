import { NextResponse } from "next/server";
import type { FetchRunStatus, Prisma } from "@/lib/generated/prisma";

export const FETCH_RUN_QUOTA_LIMITS = {
  userActive: 2,
  globalActive: 20,
  userHourly: 6,
  globalHourly: 120,
  windowSeconds: 60 * 60,
} as const;

export const FETCH_RUN_STALE_AFTER_MS = 30 * 60 * 1000;
export const FETCH_RUN_STALE_ERROR =
  "Dispatch timeout: worker did not report status within 30 minutes";

export function fetchRunStaleCutoff(now = new Date()) {
  return new Date(now.getTime() - FETCH_RUN_STALE_AFTER_MS);
}

export type FetchRunQuotaReason =
  | "USER_ACTIVE_LIMIT"
  | "GLOBAL_ACTIVE_LIMIT"
  | "USER_HOURLY_LIMIT"
  | "GLOBAL_HOURLY_LIMIT";

export type FetchRunQuotaViolation = {
  reason: FetchRunQuotaReason;
  limit: number;
  retryAfter: 30 | 3600;
};

// This two-int namespace cannot collide with the single-bigint per-run locks.
// Every quota check takes the same transaction lock, so count plus write is
// atomic across users and serverless instances without another ledger table.
const FETCH_RUN_QUOTA_LOCK_NAMESPACE = 0x4a4f424c; // "JOBL"
const FETCH_RUN_QUOTA_LOCK_KEY = 0x46544348; // "FTCH"

type FetchRunQuotaMode = "create" | "trigger" | "reactivate";

interface FetchRunQuotaSnapshot {
  userActive: number;
  globalActive: number;
  userHourly: number;
  globalHourly: number;
}

function exceedsActiveQuota(
  count: number,
  limit: number,
  mode: FetchRunQuotaMode,
) {
  // A fresh trigger is already present in active counts. Create and stale
  // reactivation add active capacity after this snapshot.
  return mode === "trigger" ? count > limit : count >= limit;
}

function exceedsHourlyQuota(
  count: number,
  limit: number,
  mode: FetchRunQuotaMode,
) {
  // Reactivation does not create another row, so a run created in the current
  // window is already represented just like an ordinary trigger.
  return mode === "create" ? count >= limit : count > limit;
}

async function acquireFetchRunQuotaLock(
  tx: Prisma.TransactionClient,
): Promise<void> {
  // PostgreSQL `void` cannot be deserialized by Prisma's adapter, so this
  // advisory lock intentionally uses $executeRaw instead of $queryRaw.
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      ${FETCH_RUN_QUOTA_LOCK_NAMESPACE}::integer,
      ${FETCH_RUN_QUOTA_LOCK_KEY}::integer
    )
  `;
}

async function readFetchRunQuotaSnapshot(
  tx: Prisma.TransactionClient,
  userId: string,
  now: Date,
): Promise<FetchRunQuotaSnapshot> {
  const activeStatuses: FetchRunStatus[] = ["QUEUED", "RUNNING"];
  const activeCutoff = fetchRunStaleCutoff(now);
  const windowStart = new Date(
    now.getTime() - FETCH_RUN_QUOTA_LIMITS.windowSeconds * 1000,
  );
  const userActive = await tx.fetchRun.count({
    where: {
      userId,
      status: { in: activeStatuses },
      updatedAt: { gte: activeCutoff },
    },
  });
  const globalActive = await tx.fetchRun.count({
    where: {
      status: { in: activeStatuses },
      updatedAt: { gte: activeCutoff },
    },
  });
  const userHourly = await tx.fetchRun.count({
    where: { userId, createdAt: { gte: windowStart } },
  });
  const globalHourly = await tx.fetchRun.count({
    where: { createdAt: { gte: windowStart } },
  });
  return { userActive, globalActive, userHourly, globalHourly };
}

function candidate(
  exceeded: boolean,
  reason: FetchRunQuotaReason,
  limit: number,
  retryAfter: 30 | 3600,
): FetchRunQuotaViolation & { exceeded: boolean } {
  return { exceeded, reason, limit, retryAfter };
}

function quotaCandidates(
  snapshot: FetchRunQuotaSnapshot,
  mode: FetchRunQuotaMode,
): Array<FetchRunQuotaViolation & { exceeded: boolean }> {
  return [
    candidate(
      exceedsActiveQuota(
        snapshot.userActive,
        FETCH_RUN_QUOTA_LIMITS.userActive,
        mode,
      ),
      "USER_ACTIVE_LIMIT",
      FETCH_RUN_QUOTA_LIMITS.userActive,
      30,
    ),
    candidate(
      exceedsActiveQuota(
        snapshot.globalActive,
        FETCH_RUN_QUOTA_LIMITS.globalActive,
        mode,
      ),
      "GLOBAL_ACTIVE_LIMIT",
      FETCH_RUN_QUOTA_LIMITS.globalActive,
      30,
    ),
    candidate(
      exceedsHourlyQuota(
        snapshot.userHourly,
        FETCH_RUN_QUOTA_LIMITS.userHourly,
        mode,
      ),
      "USER_HOURLY_LIMIT",
      FETCH_RUN_QUOTA_LIMITS.userHourly,
      3600,
    ),
    candidate(
      exceedsHourlyQuota(
        snapshot.globalHourly,
        FETCH_RUN_QUOTA_LIMITS.globalHourly,
        mode,
      ),
      "GLOBAL_HOURLY_LIMIT",
      FETCH_RUN_QUOTA_LIMITS.globalHourly,
      3600,
    ),
  ];
}

function quotaViolation(
  snapshot: FetchRunQuotaSnapshot,
  mode: FetchRunQuotaMode,
): FetchRunQuotaViolation | null {
  const candidates = quotaCandidates(snapshot, mode);
  const match = candidates.find((candidate) => candidate.exceeded);
  if (!match) return null;
  const { exceeded: _exceeded, ...violation } = match;
  return violation;
}

export async function checkFetchRunQuota(
  tx: Prisma.TransactionClient,
  userId: string,
  mode: FetchRunQuotaMode,
  now = new Date(),
): Promise<FetchRunQuotaViolation | null> {
  await acquireFetchRunQuotaLock(tx);
  // Stale rows are excluded from capacity immediately. Their terminal
  // projection is written separately under the per-run FRUN lock.
  const snapshot = await readFetchRunQuotaSnapshot(tx, userId, now);
  return quotaViolation(snapshot, mode);
}

export function fetchRunQuotaExceededResponse(violation: FetchRunQuotaViolation) {
  return NextResponse.json(
    {
      error: {
        code: "FETCH_RUN_QUOTA_EXCEEDED",
        message: "Free fetch capacity is busy right now. Try again shortly.",
        reason: violation.reason,
        limit: violation.limit,
      },
    },
    {
      status: 429,
      headers: { "Retry-After": String(violation.retryAfter) },
    },
  );
}
