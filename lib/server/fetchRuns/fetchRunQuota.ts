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

function exceedsQuota(count: number, limit: number, mode: "create" | "trigger") {
  // Trigger counts already include the current queued row; create counts do not.
  return mode === "create" ? count >= limit : count > limit;
}

export async function checkFetchRunQuota(
  tx: Prisma.TransactionClient,
  userId: string,
  mode: "create" | "trigger",
  now = new Date(),
): Promise<FetchRunQuotaViolation | null> {
  // pg_advisory_xact_lock() returns PostgreSQL `void`. Prisma's driver adapter
  // cannot deserialize that type through $queryRaw, while $executeRaw runs the
  // same statement without mapping a result column back into JavaScript.
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      ${FETCH_RUN_QUOTA_LOCK_NAMESPACE}::integer,
      ${FETCH_RUN_QUOTA_LOCK_KEY}::integer
    )
  `;

  const activeStatuses: FetchRunStatus[] = ["QUEUED", "RUNNING"];
  // No cron is required for quota recovery. Any create/trigger first expires
  // abandoned rows while holding the same global quota lock, so stale activity
  // cannot permanently consume user or service capacity.
  await tx.fetchRun.updateMany({
    where: {
      status: { in: activeStatuses },
      updatedAt: { lt: fetchRunStaleCutoff(now) },
    },
    data: { status: "FAILED", error: FETCH_RUN_STALE_ERROR },
  });

  const windowStart = new Date(now.getTime() - FETCH_RUN_QUOTA_LIMITS.windowSeconds * 1000);

  // Read the complete quota snapshot under the lock before choosing a violation.
  const userActive = await tx.fetchRun.count({
    where: { userId, status: { in: activeStatuses } },
  });
  const globalActive = await tx.fetchRun.count({
    where: { status: { in: activeStatuses } },
  });
  const userHourly = await tx.fetchRun.count({
    where: { userId, createdAt: { gte: windowStart } },
  });
  const globalHourly = await tx.fetchRun.count({
    where: { createdAt: { gte: windowStart } },
  });

  if (exceedsQuota(userActive, FETCH_RUN_QUOTA_LIMITS.userActive, mode)) {
    return {
      reason: "USER_ACTIVE_LIMIT",
      limit: FETCH_RUN_QUOTA_LIMITS.userActive,
      retryAfter: 30,
    };
  }
  if (exceedsQuota(globalActive, FETCH_RUN_QUOTA_LIMITS.globalActive, mode)) {
    return {
      reason: "GLOBAL_ACTIVE_LIMIT",
      limit: FETCH_RUN_QUOTA_LIMITS.globalActive,
      retryAfter: 30,
    };
  }
  if (exceedsQuota(userHourly, FETCH_RUN_QUOTA_LIMITS.userHourly, mode)) {
    return {
      reason: "USER_HOURLY_LIMIT",
      limit: FETCH_RUN_QUOTA_LIMITS.userHourly,
      retryAfter: 3600,
    };
  }
  if (exceedsQuota(globalHourly, FETCH_RUN_QUOTA_LIMITS.globalHourly, mode)) {
    return {
      reason: "GLOBAL_HOURLY_LIMIT",
      limit: FETCH_RUN_QUOTA_LIMITS.globalHourly,
      retryAfter: 3600,
    };
  }

  return null;
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
