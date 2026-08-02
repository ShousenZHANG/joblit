import { randomUUID } from "node:crypto";
import type {
  ApplicationBatchStatus,
  ApplicationBatchTaskStatus,
  Prisma,
} from "@/lib/generated/prisma";
import { prisma } from "@/lib/server/prisma";
import {
  acquireApplicationBatchLock,
  acquireTailoringRunLocks,
} from "@/lib/server/tailoringRuns/tailoringRunLock";
import {
  reconcileBoundApplicationBatch,
  settleBoundRunFromTask,
} from "@/lib/server/tailoringRuns/tailoringBatchProjection";
import { TailoringRunError } from "@/lib/server/tailoringRuns/tailoringRunProtocol";
import type { TailoringRunTransaction } from "@/lib/server/tailoringRuns/tailoringRunDatabase";
import { APPLICATION_BATCH_TASK_LEASE_MS } from "@/lib/server/tailoringRuns/tailoringRunLease";
import {
  APPLICATION_BATCH_TAILORING_PROTOCOL_VERSION,
  applicationBatchTailoringIssueKey,
  applicationBatchTargetProgress,
} from "./tailoringTaskContract";
import { reconcileApplicationBatchTx } from "./batchReconciliation";
import { queueApplicationBatch } from "./queueApplicationBatch";
import { taskProgressFromGroupBy, type BatchProgress } from "./batchProgress";

export type { BatchProgress } from "./batchProgress";

const TERMINAL_BATCH_STATUSES: ApplicationBatchStatus[] = [
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
];

const TERMINAL_TASK_STATUSES: ApplicationBatchTaskStatus[] = [
  "SUCCEEDED",
  "FAILED",
  "SKIPPED",
];
const STALE_TASK_TIMEOUT_MS = APPLICATION_BATCH_TASK_LEASE_MS;
const TASK_LEASE_MS = APPLICATION_BATCH_TASK_LEASE_MS;
const MAX_LEASE_RETRY_HINT_MS = 30_000;

function safeTaskError(error: string | null | undefined): string {
  return (error?.trim() || "TASK_FAILED")
    .replace(/run_[A-Za-z0-9_-]+/g, "[private executor id]")
    .slice(0, 500);
}

export class BatchRunnerError extends Error {
  code: "NOT_FOUND" | "INVALID_STATE";

  constructor(code: "NOT_FOUND" | "INVALID_STATE", message: string) {
    super(message);
    this.code = code;
  }
}

type ClaimResult =
  | {
      kind: "claimed";
      task: {
        id: string;
        attemptId: string;
        issueKey: string;
        protocolVersion: typeof APPLICATION_BATCH_TAILORING_PROTOCOL_VERSION;
        acceptedTargets: Array<"RESUME" | "COVER">;
        remainingTargets: Array<"RESUME" | "COVER">;
        jobId: string;
        title: string;
        company: string | null;
        jobUrl: string;
      };
    }
  | {
      kind: "done";
      batchStatus: ApplicationBatchStatus;
      progress: BatchProgress;
    }
  | { kind: "terminal"; batchStatus: ApplicationBatchStatus }
  | { kind: "not_found" };

type RetryBatchResult = {
  batch: {
    id: string;
    scope: "NEW";
    status: ApplicationBatchStatus;
    totalCount: number;
    createdAt: Date;
  };
  sourceBatchId: string;
};

export async function getBatchProgress(input: {
  userId: string;
  batchId: string;
}) {
  const grouped = await prisma.applicationBatchTask.groupBy({
    by: ["status"],
    where: {
      batchId: input.batchId,
      userId: input.userId,
    },
    _count: {
      _all: true,
    },
  });
  return taskProgressFromGroupBy(grouped);
}

/**
 * Tell an external Runner when the earliest live task can be reclaimed.
 *
 * The returned delay is deliberately capped: callers poll the authoritative
 * batch state at least every 30 seconds instead of sleeping for the full
 * twenty-minute task lease. The absolute deadline remains available for
 * diagnostics and scheduling.
 */
export async function getBatchLeaseRetryHint(input: {
  userId: string;
  batchId: string;
  now?: Date;
}): Promise<{
  retryAfterMs: number;
  earliestLeaseExpiresAt: string;
} | null> {
  const now = input.now ?? new Date();
  const runningTasks = await prisma.applicationBatchTask.findMany({
    where: {
      batchId: input.batchId,
      userId: input.userId,
      status: "RUNNING",
      completedAt: null,
    },
    select: {
      executionLeaseExpiresAt: true,
      startedAt: true,
    },
  });

  let earliestDeadline: Date | null = null;
  for (const task of runningTasks) {
    const deadline =
      task.executionLeaseExpiresAt ??
      (task.startedAt
        ? new Date(task.startedAt.getTime() + STALE_TASK_TIMEOUT_MS)
        : now);
    if (!earliestDeadline || deadline < earliestDeadline) {
      earliestDeadline = deadline;
    }
  }
  if (!earliestDeadline) return null;

  return {
    retryAfterMs: Math.min(
      MAX_LEASE_RETRY_HINT_MS,
      Math.max(1, earliestDeadline.getTime() - now.getTime()),
    ),
    earliestLeaseExpiresAt: earliestDeadline.toISOString(),
  };
}

async function reconcileBatchStatus(input: {
  userId: string;
  batchId: string;
}) {
  return prisma.$transaction(async (tx) => {
    await acquireApplicationBatchLock(tx, input.batchId);
    const reconciled = await reconcileApplicationBatchTx(tx, input);
    if (!reconciled) {
      throw new BatchRunnerError("NOT_FOUND", "Batch not found");
    }
    return reconciled;
  });
}

async function reclaimStaleBatchTasksTx(
  tx: Prisma.TransactionClient,
  input: { userId: string; batchId: string },
): Promise<void> {
  const now = new Date();
  await tx.applicationBatchTask.updateMany({
    where: {
      batchId: input.batchId,
      userId: input.userId,
      status: "RUNNING",
      completedAt: null,
      OR: [
        { executionLeaseExpiresAt: { lte: now } },
        {
          executionLeaseExpiresAt: null,
          startedAt: {
            lte: new Date(now.getTime() - STALE_TASK_TIMEOUT_MS),
          },
        },
      ],
    },
    data: {
      status: "PENDING",
      startedAt: null,
      completedAt: null,
      executionAttemptId: null,
      executionLeaseExpiresAt: null,
      completionAttemptId: null,
      error: "Task reclaimed after stale RUNNING timeout",
      attempt: {
        increment: 1,
      },
    },
  });
}

/**
 * Return tasks stuck in RUNNING past the stale timeout to the queue.
 *
 * Scoped to the whole batch, so it is per-run work, not per-claim work. A
 * caller claiming N tasks in a loop should call this once and then pass
 * `skipStaleReclaim` — otherwise the same full-batch `updateMany` runs N times
 * and only the first can do anything.
 */
export async function reclaimStaleBatchTasks(input: {
  userId: string;
  batchId: string;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await acquireApplicationBatchLock(tx, input.batchId);
    await reclaimStaleBatchTasksTx(tx, input);
  });
}

export async function claimNextBatchTask(input: {
  userId: string;
  batchId: string;
  /** Set when the caller already reclaimed for this run. */
  skipStaleReclaim?: boolean;
}): Promise<ClaimResult> {
  const claimed = await prisma.$transaction(async (tx) => {
    await acquireApplicationBatchLock(tx, input.batchId);

    const batch = await tx.applicationBatch.findFirst({
      where: {
        id: input.batchId,
        userId: input.userId,
      },
      select: {
        id: true,
        status: true,
      },
    });

    if (!batch) return { kind: "not_found" as const };
    if (TERMINAL_BATCH_STATUSES.includes(batch.status)) {
      return { kind: "terminal" as const, batchStatus: batch.status };
    }

    if (batch.status === "QUEUED") {
      await tx.applicationBatch.updateMany({
        where: {
          id: batch.id,
          userId: input.userId,
          status: "QUEUED",
        },
        data: {
          status: "RUNNING",
          startedAt: new Date(),
        },
      });
    }

    if (!input.skipStaleReclaim) {
      await reclaimStaleBatchTasksTx(tx, input);
    }

    const candidate = await tx.applicationBatchTask.findFirst({
      where: {
        batchId: input.batchId,
        userId: input.userId,
        status: "PENDING",
      },
      orderBy: {
        createdAt: "asc",
      },
      select: {
        id: true,
        jobId: true,
        job: {
          select: {
            title: true,
            company: true,
            jobUrl: true,
          },
        },
        tailoringRun: {
          select: {
            requiredTargetMask: true,
            acceptedTargetMask: true,
            issueKey: true,
          },
        },
      },
    });

    if (!candidate) return { kind: "empty" as const };

    const executionAttemptId = randomUUID();
    await tx.applicationBatchTask.update({
      where: {
        id: candidate.id,
      },
      data: {
        status: "RUNNING",
        startedAt: new Date(),
        executionAttemptId,
        executionLeaseExpiresAt: new Date(Date.now() + TASK_LEASE_MS),
        tailoringProtocolVersion: APPLICATION_BATCH_TAILORING_PROTOCOL_VERSION,
        completionAttemptId: null,
        error: null,
      },
    });
    const targetProgress = applicationBatchTargetProgress({
      requiredTargetMask: candidate.tailoringRun?.requiredTargetMask,
      acceptedTargetMask: candidate.tailoringRun?.acceptedTargetMask,
    });

    return {
      kind: "claimed" as const,
      task: {
        id: candidate.id,
        attemptId: executionAttemptId,
        issueKey:
          candidate.tailoringRun?.issueKey ??
          applicationBatchTailoringIssueKey(candidate.id),
        protocolVersion: APPLICATION_BATCH_TAILORING_PROTOCOL_VERSION,
        ...targetProgress,
        jobId: candidate.jobId,
        title: candidate.job.title,
        company: candidate.job.company,
        jobUrl: candidate.job.jobUrl,
      },
    };
  });

  if (claimed.kind !== "empty") return claimed;
  const reconciled = await reconcileBatchStatus(input);
  return {
    kind: "done",
    batchStatus: reconciled.batchStatus,
    progress: reconciled.progress,
  };
}

export async function completeBatchTask(input: {
  userId: string;
  batchId: string;
  taskId: string;
  attemptId: string;
  status: Extract<
    ApplicationBatchTaskStatus,
    "SUCCEEDED" | "FAILED" | "SKIPPED"
  >;
  error?: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    await acquireApplicationBatchLock(tx, input.batchId);
    const task = await tx.applicationBatchTask.findFirst({
      where: {
        id: input.taskId,
        batchId: input.batchId,
        userId: input.userId,
      },
      select: {
        id: true,
        status: true,
        executionAttemptId: true,
      },
    });
    if (!task) throw new BatchRunnerError("NOT_FOUND", "Task not found");

    if (task.executionAttemptId !== input.attemptId) {
      throw new BatchRunnerError(
        "INVALID_STATE",
        "Task execution attempt is stale",
      );
    }

    if (task.status !== "RUNNING") {
      if (
        TERMINAL_TASK_STATUSES.includes(task.status) &&
        task.status === input.status
      ) {
        const projection = await reconcileBoundApplicationBatch(
          tx as unknown as TailoringRunTransaction,
          input.userId,
          input.batchId,
        );
        return {
          taskStatus: task.status,
          ...projection,
        };
      }
      throw new BatchRunnerError("INVALID_STATE", "Task is not running");
    }

    if (input.status === "SUCCEEDED") {
      throw new BatchRunnerError(
        "INVALID_STATE",
        "Task success is committed by TailoringRun acceptance",
      );
    }

    const taskError =
      input.status === "FAILED" ? safeTaskError(input.error) : null;
    try {
      await settleBoundRunFromTask(tx as unknown as TailoringRunTransaction, {
        userId: input.userId,
        taskId: task.id,
        executionAttemptId: input.attemptId,
        status: input.status,
        error: taskError,
      });
    } catch (error) {
      if (error instanceof TailoringRunError) {
        throw new BatchRunnerError("INVALID_STATE", error.message);
      }
      throw error;
    }

    await tx.applicationBatchTask.update({
      where: {
        id: task.id,
      },
      data: {
        status: input.status,
        error: taskError,
        completedAt: new Date(),
        executionLeaseExpiresAt: null,
        completionAttemptId: null,
      },
    });
    const projection = await reconcileBoundApplicationBatch(
      tx as unknown as TailoringRunTransaction,
      input.userId,
      input.batchId,
    );
    return {
      taskStatus: input.status,
      ...projection,
    };
  });
}

export async function cancelBatch(input: { userId: string; batchId: string }) {
  const cancelled = await prisma.$transaction(async (tx) => {
    await acquireApplicationBatchLock(tx, input.batchId);
    const batch = await tx.applicationBatch.findFirst({
      where: {
        id: input.batchId,
        userId: input.userId,
      },
      select: {
        id: true,
        status: true,
      },
    });

    if (!batch) throw new BatchRunnerError("NOT_FOUND", "Batch not found");
    if (TERMINAL_BATCH_STATUSES.includes(batch.status)) {
      return { batchStatus: batch.status, alreadyTerminal: true };
    }

    const terminalAt = new Date();
    await tx.applicationBatch.update({
      where: { id: batch.id },
      data: {
        status: "CANCELLED",
        error: "Cancelled by user",
        completedAt: terminalAt,
      },
    });
    await tx.applicationBatchTask.updateMany({
      where: {
        batchId: batch.id,
        userId: input.userId,
        status: {
          in: ["PENDING", "RUNNING"],
        },
      },
      data: {
        status: "SKIPPED",
        error: "Cancelled by user",
        completedAt: terminalAt,
        executionLeaseExpiresAt: null,
        completionAttemptId: null,
      },
    });
    const boundRuns = await tx.tailoringRun.findMany({
      where: {
        applicationBatchTask: {
          batchId: batch.id,
          userId: input.userId,
        },
        status: {
          in: ["ISSUED", "RUNNING"],
        },
      },
      select: { id: true },
    });
    await acquireTailoringRunLocks(
      tx,
      boundRuns.map((run) => run.id),
    );
    await tx.tailoringRun.updateMany({
      where: {
        applicationBatchTask: {
          batchId: batch.id,
          userId: input.userId,
        },
        status: {
          in: ["ISSUED", "RUNNING"],
        },
        acceptedTargetMask: 0,
      },
      data: {
        status: "CANCELLED",
        errorCode: "BATCH_CANCELLED",
        errorMessage: "Cancelled by user",
        executionLeaseExpiresAt: null,
        terminalAt,
      },
    });
    await tx.tailoringRun.updateMany({
      where: {
        applicationBatchTask: {
          batchId: batch.id,
          userId: input.userId,
        },
        status: {
          in: ["ISSUED", "RUNNING"],
        },
        acceptedTargetMask: {
          gt: 0,
        },
      },
      data: {
        status: "PARTIAL",
        errorCode: "BATCH_CANCELLED",
        errorMessage: "Cancelled after partial acceptance",
        executionLeaseExpiresAt: null,
        terminalAt,
      },
    });
    return { batchStatus: "CANCELLED" as const, alreadyTerminal: false };
  });

  return {
    batchStatus: cancelled.batchStatus,
    progress: await getBatchProgress(input),
    alreadyTerminal: cancelled.alreadyTerminal,
  };
}

export async function createRetryBatchFromFailed(input: {
  userId: string;
  sourceBatchId: string;
  limit?: number;
}): Promise<RetryBatchResult> {
  const outcome = await queueApplicationBatch({
    userId: input.userId,
    seed: {
      kind: "retry_failed",
      sourceBatchId: input.sourceBatchId,
      limit: input.limit,
    },
  });
  if (outcome.kind === "source_not_found") {
    throw new BatchRunnerError("NOT_FOUND", "Batch not found");
  }
  if (outcome.kind === "active_exists") {
    throw new BatchRunnerError("INVALID_STATE", "Active batch already exists");
  }
  if (outcome.kind === "empty") {
    throw new BatchRunnerError("INVALID_STATE", "No failed tasks to retry");
  }
  return {
    batch: outcome.batch,
    sourceBatchId: outcome.sourceBatchId ?? input.sourceBatchId,
  };
}
