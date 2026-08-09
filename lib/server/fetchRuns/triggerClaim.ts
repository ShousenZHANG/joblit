import { randomUUID } from "node:crypto";
import type { Prisma } from "@/lib/generated/prisma";
import { prisma } from "@/lib/server/prisma";
import { tryAcquireFetchRunDispatchLock } from "./fetchRunLifecycleLock";
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
  };
}>;

export interface LockedTriggerClaim {
  kind: "locked";
  market: "AU";
  queries: Prisma.JsonValue;
  claimedQueries: Record<string, unknown>;
  attemptId: string;
}

export type TriggerClaimResult =
  | LockedTriggerClaim
  | { kind: "lock_contended" }
  | { kind: "not_found" }
  | { kind: "retired_market" }
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

function replayableIdempotencyClaim(
  request: TriggerClaimRequest,
  meta: ReturnType<typeof readFetchRunDispatchMeta>,
  nowMs: number,
): TriggerClaimResult | null {
  if (
    !request.idempotencyKey ||
    meta.idempotencyKey !== request.idempotencyKey ||
    !meta.idempotencyAt
  ) {
    return null;
  }
  const ageMs = nowMs - Date.parse(meta.idempotencyAt);
  if (Number.isNaN(ageMs) || ageMs >= IDEMPOTENCY_WINDOW_MS) return null;
  return {
    kind: "idempotent_replay",
    alreadyDispatched: Boolean(meta.dispatchedAt || meta.inFlightAt),
  };
}

async function claimQueuedRun(
  tx: Prisma.TransactionClient,
  request: TriggerClaimRequest,
  run: ClaimableFetchRun & { market: "AU" },
): Promise<TriggerClaimResult> {
  const meta = readFetchRunDispatchMeta(run.queries);
  const now = new Date();
  const replay = replayableIdempotencyClaim(request, meta, now.getTime());
  if (replay) return replay;
  if (meta.dispatchedAt || meta.inFlightAt) {
    return { kind: "already_dispatched" };
  }

  const claimedAt = now.toISOString();
  const claimedQueries = withFetchRunDispatchMeta(run.queries, {
    inFlightAt: claimedAt,
    ...(request.idempotencyKey
      ? {
          idempotencyKey: request.idempotencyKey,
          idempotencyAt: claimedAt,
        }
      : {}),
  });
  const claimed = await tx.fetchRun.updateMany({
    where: { id: request.runId, userId: request.userId, status: "QUEUED" },
    data: { queries: claimedQueries as Prisma.InputJsonValue },
  });
  return claimed.count > 0
    ? {
        kind: "locked",
        market: "AU",
        queries: run.queries,
        claimedQueries,
        attemptId: randomUUID(),
      }
    : { kind: "state_changed" };
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
      select: { id: true, status: true, market: true, queries: true },
    });
    if (!run) return { kind: "not_found" };
    if (run.market !== "AU") return { kind: "retired_market" };
    if (run.status !== "QUEUED") {
      return { kind: "invalid_state", status: run.status };
    }
    return claimQueuedRun(tx, request, { ...run, market: "AU" });
  });
}
