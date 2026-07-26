import {
  TailoringRunError,
} from "./tailoringRunProtocol";
import type { Prisma } from "@/lib/generated/prisma";
import { acquireTailoringRunLock } from "./tailoringRunLock";
import type {
  TailoringBatchTaskRow,
  TailoringRunTransaction,
} from "./tailoringRunDatabase";
import { APPLICATION_BATCH_TAILORING_PROTOCOL_VERSION } from "../applicationBatches/tailoringTaskContract";

type TerminalTaskStatus = "SUCCEEDED" | "FAILED" | "SKIPPED";

function safeTaskFailureMessage(
  status: Extract<TerminalTaskStatus, "FAILED" | "SKIPPED">,
  error: string | null | undefined,
): string {
  const fallback =
    status === "FAILED" ? "Batch task failed" : "Batch task skipped";
  return (error?.trim() || fallback)
    .replace(/run_[A-Za-z0-9_-]+/g, "[private executor id]")
    .slice(0, 500);
}

/**
 * Project an authoritative batch failure/skip back into its bound run.
 *
 * The caller must already hold ABAT and must have fenced the task attempt.
 * This helper then takes TLRN, so the run and task terminal writes can land in
 * one transaction without reversing the global lock order.
 */
export async function settleBoundRunFromTask(
  tx: TailoringRunTransaction,
  input: {
    userId: string;
    taskId: string;
    executionAttemptId: string;
    status: Extract<TerminalTaskStatus, "FAILED" | "SKIPPED">;
    error?: string | null;
  },
): Promise<boolean> {
  const stale = await tx.tailoringRun.findFirst({
    where: {
      userId: input.userId,
      applicationBatchTaskId: input.taskId,
    },
  });
  if (!stale) return false;

  await acquireTailoringRunLock(
    tx as unknown as Prisma.TransactionClient,
    stale.id,
  );
  const run = await tx.tailoringRun.findFirst({
    where: {
      id: stale.id,
      userId: input.userId,
      applicationBatchTaskId: input.taskId,
    },
  });
  if (!run) return false;
  if (run.status === "SUCCEEDED") {
    throw new TailoringRunError(
      "RUN_ALREADY_TERMINAL",
      "A successful TailoringRun cannot be overwritten by task failure",
    );
  }

  const terminalStatus =
    run.acceptedTargetMask > 0
      ? "PARTIAL"
      : input.status === "FAILED"
        ? "FAILED"
        : "CANCELLED";
  if (["FAILED", "CANCELLED", "PARTIAL"].includes(run.status)) {
    if (run.status === terminalStatus) return true;
    throw new TailoringRunError(
      "INVALID_STATE",
      "The TailoringRun already has a different terminal outcome",
    );
  }

  const sameAttempt = run.executionAttemptId === input.executionAttemptId;
  await tx.tailoringRun.update({
    where: { id: run.id },
    data: {
      status: terminalStatus,
      executionAttemptId: input.executionAttemptId,
      executionLeaseExpiresAt: null,
      attempt: sameAttempt ? run.attempt : { increment: 1 },
      errorCode:
        input.status === "FAILED"
          ? "BATCH_TASK_FAILED"
          : "BATCH_TASK_SKIPPED",
      errorMessage: safeTaskFailureMessage(input.status, input.error),
      terminalAt: new Date(),
    },
  });
  return true;
}

export async function completeBoundBatchTask(
  tx: TailoringRunTransaction,
  task: TailoringBatchTaskRow,
  executionAttemptId: string,
  status: TerminalTaskStatus,
  error: string | null,
): Promise<void> {
  const updated = await tx.applicationBatchTask.updateMany({
    where: {
      id: task.id,
      batchId: task.batchId,
      userId: task.userId,
      status: "RUNNING",
      executionAttemptId,
      tailoringProtocolVersion:
        APPLICATION_BATCH_TAILORING_PROTOCOL_VERSION,
    },
    data: {
      status,
      error,
      completedAt: new Date(),
      executionLeaseExpiresAt: null,
      completionAttemptId:
        status === "SUCCEEDED" ? executionAttemptId : null,
    },
  });
  if (updated.count !== 1) {
    throw new TailoringRunError(
      "BATCH_ATTEMPT_MISMATCH",
      "The batch task attempt has been superseded",
    );
  }
  await reconcileBoundApplicationBatch(tx, task.userId, task.batchId);
}

export type TailoringBatchProgress = {
  pending: number;
  running: number;
  succeeded: number;
  failed: number;
  skipped: number;
};

function progressFrom(
  rows: Array<{ status: string; _count: { _all: number } }>,
): TailoringBatchProgress {
  const progress: TailoringBatchProgress = {
    pending: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
  };
  for (const row of rows) {
    const count = row._count._all;
    if (row.status === "PENDING") progress.pending = count;
    if (row.status === "RUNNING") progress.running = count;
    if (row.status === "SUCCEEDED") progress.succeeded = count;
    if (row.status === "FAILED") progress.failed = count;
    if (row.status === "SKIPPED") progress.skipped = count;
  }
  return progress;
}

function projectedBatchStatus(progress: TailoringBatchProgress): string {
  if (progress.pending > 0 || progress.running > 0) return "RUNNING";
  if (progress.failed > 0) return "FAILED";
  return "SUCCEEDED";
}

export async function reconcileBoundApplicationBatch(
  tx: TailoringRunTransaction,
  userId: string,
  batchId: string,
): Promise<{
  batchStatus: string;
  progress: TailoringBatchProgress;
}> {
  const [batch, grouped] = await Promise.all([
    tx.applicationBatch.findFirst({
      where: { id: batchId, userId },
      select: { id: true, status: true, startedAt: true, completedAt: true },
    }),
    tx.applicationBatchTask.groupBy({
      by: ["status"],
      where: { batchId, userId },
      _count: { _all: true },
    }),
  ]);
  if (!batch) {
    throw new TailoringRunError(
      "BATCH_TASK_NOT_FOUND",
      "Application batch not found",
    );
  }
  const progress = progressFrom(grouped);
  if (["SUCCEEDED", "FAILED", "CANCELLED"].includes(batch.status)) {
    return { batchStatus: batch.status, progress };
  }
  const nextStatus = projectedBatchStatus(progress);
  const terminal = nextStatus === "SUCCEEDED" || nextStatus === "FAILED";
  await tx.applicationBatch.update({
    where: { id: batch.id },
    data: {
      status: nextStatus,
      startedAt: batch.startedAt ?? new Date(),
      completedAt: terminal ? batch.completedAt ?? new Date() : null,
      error: nextStatus === "FAILED" ? "One or more tasks failed." : null,
    },
  });
  return { batchStatus: nextStatus, progress };
}
