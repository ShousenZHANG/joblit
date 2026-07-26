import type { Prisma } from "@/lib/generated/prisma";
import { processCnFetchRun } from "@/lib/server/cnFetch/processFetchRun";
import {
  FETCH_RUN_COMMIT_PROTOCOL,
  commitFetchRun,
  fetchRunExecutionStopReason,
} from "@/lib/server/fetchRuns/fetchRunCommit";
import type {
  LockedInlineTriggerClaim,
  TriggerClaimRequest,
} from "@/lib/server/fetchRuns/triggerClaim";
import { prisma } from "@/lib/server/prisma";
import { processGlobalFetchRun } from "@/lib/server/sources/processGlobalFetchRun";
import {
  readFetchRunDispatchMeta,
  withFetchRunDispatchMeta,
} from "@/lib/shared/schemas/fetchRunConfig";

interface InlineProcessorResult {
  imported: number;
  discovered: number;
  cancelled?: boolean;
  superseded?: boolean;
  error?: string;
}

export type InlineFetchRunExecutionOutcome =
  | {
      kind: "completed";
      imported: number;
      discovered: number;
    }
  | { kind: "cancelled" }
  | { kind: "superseded" }
  | { kind: "no_longer_active" }
  | { kind: "failed"; market: "CN" | "GLOBAL" };

async function startInlineExecution(
  request: TriggerClaimRequest,
  claim: LockedInlineTriggerClaim,
): Promise<InlineFetchRunExecutionOutcome | null> {
  try {
    await commitFetchRun({
      protocol: FETCH_RUN_COMMIT_PROTOCOL,
      command: "start",
      runId: request.runId,
      attemptId: claim.attemptId,
    });
  } catch (error) {
    const stopReason = fetchRunExecutionStopReason(error);
    if (stopReason === "cancelled") return { kind: "cancelled" };
    if (stopReason === "superseded") return { kind: "superseded" };
    throw error;
  }

  const executionAt = new Date().toISOString();
  const claimedMeta = readFetchRunDispatchMeta(claim.claimedQueries);
  const markedRunning = await prisma.fetchRun.updateMany({
    where: {
      id: request.runId,
      userId: request.userId,
      status: "RUNNING",
      executionAttemptId: claim.attemptId,
    },
    data: {
      queries: withFetchRunDispatchMeta(claim.claimedQueries, {
        inFlightAt: executionAt,
        dispatchedAt: claimedMeta.dispatchedAt ?? executionAt,
      }) as Prisma.InputJsonValue,
    },
  });
  return markedRunning.count === 0 ? { kind: "no_longer_active" } : null;
}

function inlineProcessorOutcome(
  market: "CN" | "GLOBAL",
  result: InlineProcessorResult,
): InlineFetchRunExecutionOutcome {
  if (result.cancelled) return { kind: "cancelled" };
  if (result.superseded) return { kind: "superseded" };
  if (result.error) return { kind: "failed", market };
  return {
    kind: "completed",
    imported: result.imported,
    discovered: result.discovered,
  };
}

async function runInlineProcessor(
  request: TriggerClaimRequest,
  claim: LockedInlineTriggerClaim,
): Promise<InlineProcessorResult> {
  return claim.market === "GLOBAL"
    ? processGlobalFetchRun(request.userId, {
        id: request.runId,
        queries: claim.queries,
        attemptId: claim.attemptId,
      })
    : processCnFetchRun(request.userId, {
        id: request.runId,
        queries: claim.queries,
        attemptId: claim.attemptId,
      });
}

export async function executeInlineFetchRun(
  request: TriggerClaimRequest,
  claim: LockedInlineTriggerClaim,
): Promise<InlineFetchRunExecutionOutcome> {
  const startOutcome = await startInlineExecution(request, claim);
  if (startOutcome) return startOutcome;
  const result = await runInlineProcessor(request, claim);
  return inlineProcessorOutcome(claim.market, result);
}
