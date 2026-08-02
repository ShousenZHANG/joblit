import type { ApplicationBatchStatus, Prisma } from "@/lib/generated/prisma";
import { taskProgressFromGroupBy, type BatchProgress } from "./batchProgress";
import { acquireApplicationBatchLock } from "@/lib/server/tailoringRuns/tailoringRunLock";

const TERMINAL_BATCH_STATUSES: ApplicationBatchStatus[] = [
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
];

export function applicationBatchTaskCount(progress: BatchProgress): number {
  return (
    progress.pending +
    progress.running +
    progress.succeeded +
    progress.failed +
    progress.skipped
  );
}

export function deriveApplicationBatchStatus(input: {
  currentStatus: ApplicationBatchStatus;
  progress: BatchProgress;
}): ApplicationBatchStatus {
  if (TERMINAL_BATCH_STATUSES.includes(input.currentStatus)) {
    return input.currentStatus;
  }

  const totalCount = applicationBatchTaskCount(input.progress);
  if (totalCount === 0) return "CANCELLED";
  if (input.progress.pending > 0 || input.progress.running > 0) {
    // Removing another task must not make an untouched queued batch look as if
    // an executor started it. Once any task is/was running, RUNNING remains the
    // honest projection while live work remains.
    if (
      input.currentStatus === "QUEUED" &&
      input.progress.running === 0 &&
      input.progress.succeeded === 0 &&
      input.progress.failed === 0 &&
      input.progress.skipped === 0
    ) {
      return "QUEUED";
    }
    return "RUNNING";
  }
  if (input.progress.failed > 0) return "FAILED";
  return "SUCCEEDED";
}

export async function reconcileApplicationBatchTx(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    batchId: string;
    emptyError?: string;
  },
): Promise<{
  batchStatus: ApplicationBatchStatus;
  progress: BatchProgress;
  totalCount: number;
} | null> {
  const batch = await tx.applicationBatch.findFirst({
    where: { id: input.batchId, userId: input.userId },
    select: {
      id: true,
      status: true,
      totalCount: true,
      startedAt: true,
      completedAt: true,
    },
  });
  if (!batch) return null;

  const grouped = await tx.applicationBatchTask.groupBy({
    by: ["status"],
    where: { batchId: batch.id, userId: input.userId },
    _count: { _all: true },
  });
  const progress = taskProgressFromGroupBy(grouped);
  const totalCount = applicationBatchTaskCount(progress);

  if (TERMINAL_BATCH_STATUSES.includes(batch.status)) {
    if (batch.totalCount !== totalCount) {
      await tx.applicationBatch.update({
        where: { id: batch.id },
        data: { totalCount },
      });
    }
    return { batchStatus: batch.status, progress, totalCount };
  }

  const nextStatus = deriveApplicationBatchStatus({
    currentStatus: batch.status,
    progress,
  });
  const terminal = TERMINAL_BATCH_STATUSES.includes(nextStatus);
  const now = new Date();
  const failedError =
    nextStatus === "FAILED"
      ? ((
          await tx.applicationBatchTask.findFirst({
            where: {
              batchId: batch.id,
              userId: input.userId,
              status: "FAILED",
            },
            orderBy: { updatedAt: "desc" },
            select: { error: true },
          })
        )?.error ?? "One or more tasks failed.")
      : null;
  const emptyError =
    nextStatus === "CANCELLED" && totalCount === 0
      ? (input.emptyError ?? "No batch tasks remain.")
      : null;

  await tx.applicationBatch.update({
    where: { id: batch.id },
    data: {
      status: nextStatus,
      totalCount,
      startedAt:
        nextStatus === "CANCELLED" && totalCount === 0
          ? batch.startedAt
          : (batch.startedAt ?? (nextStatus === "QUEUED" ? null : now)),
      completedAt: terminal ? (batch.completedAt ?? now) : null,
      error: failedError ?? emptyError,
    },
  });

  return { batchStatus: nextStatus, progress, totalCount };
}

/**
 * Take every affected ABAT lock before Job deletion reaches any narrower
 * Application lock. Task rows can then cascade away without racing claim or
 * TailoringRun acceptance for the same batch.
 */
export async function lockApplicationBatchesForJobDeletion(
  tx: Prisma.TransactionClient,
  input: { userId: string; jobIds: readonly string[] },
): Promise<string[]> {
  if (input.jobIds.length === 0) return [];
  const tasks = await tx.applicationBatchTask.findMany({
    where: {
      userId: input.userId,
      jobId: { in: [...input.jobIds] },
    },
    select: { batchId: true },
  });
  const batchIds = Array.from(
    new Set(tasks.map((task) => task.batchId)),
  ).sort();
  for (const batchId of batchIds) {
    await acquireApplicationBatchLock(tx, batchId);
  }
  return batchIds;
}

export async function reconcileApplicationBatchesAfterJobDeletion(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    batchIds: readonly string[];
  },
): Promise<void> {
  for (const batchId of Array.from(new Set(input.batchIds)).sort()) {
    await reconcileApplicationBatchTx(tx, {
      userId: input.userId,
      batchId,
      emptyError: "All jobs in this batch were deleted.",
    });
  }
}
