import type { FetchRunStatus, Prisma } from "@/lib/generated/prisma";
import { discoverCnFetchRun } from "@/lib/server/cnFetch/processFetchRun";
import {
  FETCH_RUN_CANCELLED_ERROR,
  FETCH_RUN_COMMIT_PROTOCOL,
  commitFetchRun,
  fetchRunExecutionStopReason,
  type FetchRunCommitResult,
} from "@/lib/server/fetchRuns/fetchRunCommit";
import type {
  InlineFetchRunAdapter,
  InlineFetchRunTerminalPlan,
} from "@/lib/server/fetchRuns/inlineFetchRunAdapter";
import type {
  LockedInlineTriggerClaim,
  TriggerClaimRequest,
} from "@/lib/server/fetchRuns/triggerClaim";
import { reportError } from "@/lib/server/observability/errorReporter";
import { prisma } from "@/lib/server/prisma";
import { discoverGlobalFetchRun } from "@/lib/server/sources/processGlobalFetchRun";
import {
  readFetchRunDispatchMeta,
  withFetchRunDispatchMeta,
} from "@/lib/shared/schemas/fetchRunConfig";

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

const TERMINAL_FETCH_RUN_STATUSES: readonly FetchRunStatus[] = [
  "SUCCEEDED",
  "FAILED",
  "PARTIAL",
];

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
  return null;
}

async function markInlineExecutionRunning(
  request: TriggerClaimRequest,
  claim: LockedInlineTriggerClaim,
): Promise<InlineFetchRunExecutionOutcome | null> {
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
  if (markedRunning.count > 0) return null;
  return inactiveInlineOutcome(request, claim);
}

async function inactiveInlineOutcome(
  request: TriggerClaimRequest,
  claim: LockedInlineTriggerClaim,
): Promise<InlineFetchRunExecutionOutcome> {
  const current = await prisma.fetchRun.findFirst({
    where: { id: request.runId, userId: request.userId },
    select: { status: true, error: true, executionAttemptId: true },
  });
  if (!current) return { kind: "no_longer_active" };
  if (
    TERMINAL_FETCH_RUN_STATUSES.includes(current.status) &&
    current.error === FETCH_RUN_CANCELLED_ERROR
  ) {
    return { kind: "cancelled" };
  }
  if (
    current.executionAttemptId !== claim.attemptId ||
    TERMINAL_FETCH_RUN_STATUSES.includes(current.status)
  ) {
    return { kind: "superseded" };
  }
  return { kind: "no_longer_active" };
}

function adapterFor(
  market: "CN" | "GLOBAL",
): InlineFetchRunAdapter {
  return market === "GLOBAL" ? discoverGlobalFetchRun : discoverCnFetchRun;
}

async function discoverInlineRun(
  request: TriggerClaimRequest,
  claim: LockedInlineTriggerClaim,
): Promise<InlineFetchRunTerminalPlan> {
  return adapterFor(claim.market)({
    userId: request.userId,
    queries: claim.queries,
  });
}

function stoppedOutcome(
  error: unknown,
): InlineFetchRunExecutionOutcome | null {
  const stopReason = fetchRunExecutionStopReason(error);
  if (stopReason === "cancelled") return { kind: "cancelled" };
  if (stopReason === "superseded") return { kind: "superseded" };
  return null;
}

async function runCanonicalPostTerminalHook(
  plan: InlineFetchRunTerminalPlan,
  request: TriggerClaimRequest,
  claim: LockedInlineTriggerClaim,
  executionAttemptId: string | null | undefined,
): Promise<void> {
  if (executionAttemptId !== claim.attemptId || !plan.postTerminal) return;
  try {
    await plan.postTerminal();
  } catch (error) {
    // The FetchRun is already terminal. A secondary projection must never
    // turn that durable result into a second fail attempt.
    reportError(error, {
      scope: "fetch-runs.inline.post-terminal",
      severity: "warning",
      userId: request.userId,
      tags: { market: claim.market },
      extra: { runId: request.runId, attemptId: claim.attemptId },
    });
  }
}

async function applyTerminalPlan(
  request: TriggerClaimRequest,
  claim: LockedInlineTriggerClaim,
  plan: InlineFetchRunTerminalPlan,
): Promise<InlineFetchRunExecutionOutcome> {
  if (plan.kind === "fail") {
    const receipt = await commitFetchRun({
      protocol: FETCH_RUN_COMMIT_PROTOCOL,
      command: "fail",
      runId: request.runId,
      attemptId: claim.attemptId,
      error: plan.error,
    });
    await runCanonicalPostTerminalHook(
      plan,
      request,
      claim,
      receipt.executionAttemptId,
    );
    return { kind: "failed", market: claim.market };
  }

  const receipt = await commitFetchRun({
    protocol: FETCH_RUN_COMMIT_PROTOCOL,
    command: "commit",
    runId: request.runId,
    attemptId: claim.attemptId,
    batchKey: plan.batchKey,
    batchIndex: 0,
    batchCount: 1,
    items: plan.items,
    terminal: true,
    discoveredCount: plan.discovered,
    terminalOutcome: plan.terminalOutcome,
    ...(plan.error ? { error: plan.error } : {}),
  });
  await runCanonicalPostTerminalHook(
    plan,
    request,
    claim,
    receipt.executionAttemptId,
  );
  return {
    kind: "completed",
    imported: receipt.totalImported,
    discovered: plan.discovered,
  };
}

async function recoverInlineFailure(
  request: TriggerClaimRequest,
  claim: LockedInlineTriggerClaim,
  error: unknown,
  plan?: InlineFetchRunTerminalPlan,
): Promise<InlineFetchRunExecutionOutcome> {
  const stopped = stoppedOutcome(error);
  if (stopped) return stopped;

  const message =
    error instanceof Error ? error.message : "inline_fetch_failed";
  try {
    const receipt = await commitFetchRun({
      protocol: FETCH_RUN_COMMIT_PROTOCOL,
      command: "fail",
      runId: request.runId,
      attemptId: claim.attemptId,
      error: message,
    });
    return recoveredReceiptOutcome(request, claim, receipt, plan);
  } catch (failureError) {
    const failureStopped = stoppedOutcome(failureError);
    if (failureStopped) return failureStopped;
    throw failureError;
  }
}

async function recoveredReceiptOutcome(
  request: TriggerClaimRequest,
  claim: LockedInlineTriggerClaim,
  receipt: FetchRunCommitResult,
  plan?: InlineFetchRunTerminalPlan,
): Promise<InlineFetchRunExecutionOutcome> {
  if (plan) {
    await runCanonicalPostTerminalHook(
      plan,
      request,
      claim,
      receipt.executionAttemptId,
    );
  }
  if (
    plan?.kind === "commit" &&
    receipt.disposition === "REPLAYED" &&
    (receipt.status === "SUCCEEDED" || receipt.status === "PARTIAL")
  ) {
    return {
      kind: "completed",
      imported: receipt.totalImported,
      discovered: plan.discovered,
    };
  }
  if (
    receipt.disposition === "APPLIED" ||
    receipt.status === "FAILED" ||
    receipt.status === "PARTIAL"
  ) {
    return { kind: "failed", market: claim.market };
  }
  return { kind: "superseded" };
}

export async function executeInlineFetchRun(
  request: TriggerClaimRequest,
  claim: LockedInlineTriggerClaim,
): Promise<InlineFetchRunExecutionOutcome> {
  const startOutcome = await startInlineExecution(request, claim);
  if (startOutcome) return startOutcome;
  let plan: InlineFetchRunTerminalPlan | undefined;
  try {
    const runningOutcome = await markInlineExecutionRunning(request, claim);
    if (runningOutcome) return runningOutcome;
    plan = await discoverInlineRun(request, claim);
    return await applyTerminalPlan(request, claim, plan);
  } catch (error) {
    return recoverInlineFailure(request, claim, error, plan);
  }
}
