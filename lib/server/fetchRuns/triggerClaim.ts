import { randomUUID } from "node:crypto";
import type { Prisma } from "@/lib/generated/prisma";
import { tryAcquireFetchRunDispatchLock } from "./fetchRunLifecycleLock";
import { prisma } from "@/lib/server/prisma";
import { INLINE_FETCH_RUN_EXECUTION_LEASE_MS } from "@/lib/shared/fetchRunProtocol";
import {
  readFetchRunDispatchMeta,
  withFetchRunDispatchMeta,
} from "@/lib/shared/schemas/fetchRunConfig";

const IDEMPOTENCY_WINDOW_MS = 5 * 60 * 1000;

export interface TriggerClaimRequest {
  runId: string;
  userId: string;
  idempotencyKey: string | null;
}

type ClaimableFetchRun = Prisma.FetchRunGetPayload<{
  select: {
    id: true;
    status: true;
    market: true;
    queries: true;
    updatedAt: true;
    executionAttemptId: true;
    executionLeaseExpiresAt: true;
  };
}>;

interface TriggerClaimContext {
  request: TriggerClaimRequest;
  run: ClaimableFetchRun;
  meta: ReturnType<typeof readFetchRunDispatchMeta>;
  nowMs: number;
  claimedAt: string;
  attemptId: string;
}

export interface LockedTriggerClaim {
  kind: "locked";
  market: string;
  queries: Prisma.JsonValue;
  claimedQueries: Record<string, unknown>;
  attemptId: string;
}

export type LockedInlineTriggerClaim = LockedTriggerClaim & {
  market: "CN" | "GLOBAL";
};

export type TriggerClaimResult =
  | LockedTriggerClaim
  | { kind: "lock_contended" }
  | { kind: "not_found" }
  | { kind: "already_dispatched" }
  | { kind: "state_changed" }
  | { kind: "invalid_state"; status: string }
  | {
      kind: "idempotent_replay";
      alreadyDispatched: boolean;
    };

export type RejectedTriggerClaim = Exclude<
  TriggerClaimResult,
  LockedTriggerClaim
>;

function isInlineMarket(market: string): market is "CN" | "GLOBAL" {
  return market === "CN" || market === "GLOBAL";
}

export function isInlineTriggerClaim(
  claim: LockedTriggerClaim,
): claim is LockedInlineTriggerClaim {
  return isInlineMarket(claim.market);
}

function hasFreshInlineExecutionLease(
  meta: ReturnType<typeof readFetchRunDispatchMeta>,
  nowMs: number,
): boolean {
  const timestamp = meta.inFlightAt ?? meta.dispatchedAt;
  if (!timestamp) return false;
  const claimedAt = Date.parse(timestamp);
  return (
    !Number.isNaN(claimedAt) &&
    nowMs - claimedAt < INLINE_FETCH_RUN_EXECUTION_LEASE_MS
  );
}

function createTriggerClaimContext(
  request: TriggerClaimRequest,
  run: ClaimableFetchRun,
): TriggerClaimContext {
  const now = new Date();
  return {
    request,
    run,
    meta: readFetchRunDispatchMeta(run.queries),
    nowMs: now.getTime(),
    claimedAt: now.toISOString(),
    attemptId: randomUUID(),
  };
}

function lockedTriggerClaim(
  context: TriggerClaimContext,
  claimedQueries: Record<string, unknown>,
): LockedTriggerClaim {
  return {
    kind: "locked",
    market: context.run.market,
    queries: context.run.queries,
    claimedQueries,
    attemptId: context.attemptId,
  };
}

async function writeDispatchClaim(
  tx: Prisma.TransactionClient,
  context: TriggerClaimContext,
  status: "QUEUED" | "RUNNING",
  claimedQueries: Record<string, unknown>,
): Promise<boolean> {
  const claimed = await tx.fetchRun.updateMany({
    where: {
      id: context.request.runId,
      userId: context.request.userId,
      status,
    },
    data: { queries: claimedQueries as Prisma.InputJsonValue },
  });
  return claimed.count > 0;
}

async function claimRunningInlineRun(
  tx: Prisma.TransactionClient,
  context: TriggerClaimContext,
): Promise<TriggerClaimResult> {
  const { run, meta, nowMs } = context;
  const hasFreshProtocolLease =
    run.executionLeaseExpiresAt instanceof Date &&
    run.executionLeaseExpiresAt.getTime() > nowMs;
  const hasRollingUpgradeLease =
    run.executionAttemptId == null &&
    hasFreshInlineExecutionLease(meta, nowMs);
  if (hasFreshProtocolLease || hasRollingUpgradeLease) {
    return { kind: "already_dispatched" };
  }

  const claimedQueries = withFetchRunDispatchMeta(run.queries, {
    inFlightAt: context.claimedAt,
  });
  const claimed = await writeDispatchClaim(
    tx,
    context,
    "RUNNING",
    claimedQueries,
  );
  return claimed
    ? lockedTriggerClaim(context, claimedQueries)
    : { kind: "state_changed" };
}

function replayableIdempotencyClaim(
  context: TriggerClaimContext,
  reclaimableInlineClaim: boolean,
): TriggerClaimResult | null {
  const { idempotencyKey } = context.request;
  const { meta, nowMs } = context;
  if (
    !idempotencyKey ||
    meta.idempotencyKey !== idempotencyKey ||
    !meta.idempotencyAt
  ) {
    return null;
  }
  const ageMs = nowMs - Date.parse(meta.idempotencyAt);
  if (
    reclaimableInlineClaim ||
    Number.isNaN(ageMs) ||
    ageMs >= IDEMPOTENCY_WINDOW_MS
  ) {
    return null;
  }
  return {
    kind: "idempotent_replay",
    alreadyDispatched: Boolean(meta.dispatchedAt || meta.inFlightAt),
  };
}

async function claimQueuedRun(
  tx: Prisma.TransactionClient,
  context: TriggerClaimContext,
): Promise<TriggerClaimResult> {
  const { run, meta, nowMs } = context;
  const hasDispatchClaim = Boolean(meta.dispatchedAt || meta.inFlightAt);
  const reclaimableInlineClaim =
    hasDispatchClaim &&
    isInlineMarket(run.market) &&
    !hasFreshInlineExecutionLease(meta, nowMs);
  const replay = replayableIdempotencyClaim(
    context,
    reclaimableInlineClaim,
  );
  if (replay) return replay;
  if (hasDispatchClaim && !reclaimableInlineClaim) {
    return { kind: "already_dispatched" };
  }

  const claimedQueries = withFetchRunDispatchMeta(run.queries, {
    inFlightAt: context.claimedAt,
    ...(context.request.idempotencyKey
      ? {
          idempotencyKey: context.request.idempotencyKey,
          idempotencyAt: context.claimedAt,
        }
      : {}),
  });
  const claimed = await writeDispatchClaim(
    tx,
    context,
    "QUEUED",
    claimedQueries,
  );
  return claimed
    ? lockedTriggerClaim(context, claimedQueries)
    : { kind: "state_changed" };
}

async function decideTriggerClaim(
  tx: Prisma.TransactionClient,
  request: TriggerClaimRequest,
  run: ClaimableFetchRun,
): Promise<TriggerClaimResult> {
  const context = createTriggerClaimContext(request, run);
  if (run.status === "RUNNING" && isInlineMarket(run.market)) {
    return claimRunningInlineRun(tx, context);
  }
  if (run.status !== "QUEUED") {
    return { kind: "invalid_state", status: run.status };
  }
  return claimQueuedRun(tx, context);
}

export async function claimFetchRunDispatch(
  request: TriggerClaimRequest,
): Promise<TriggerClaimResult> {
  return prisma.$transaction(async (tx) => {
    if (!(await tryAcquireFetchRunDispatchLock(tx, request.runId))) {
      return { kind: "lock_contended" };
    }
    const run = await tx.fetchRun.findFirst({
      where: { id: request.runId, userId: request.userId },
      select: {
        id: true,
        status: true,
        market: true,
        queries: true,
        updatedAt: true,
        executionAttemptId: true,
        executionLeaseExpiresAt: true,
      },
    });
    if (!run) return { kind: "not_found" };
    return decideTriggerClaim(tx, request, run);
  });
}
