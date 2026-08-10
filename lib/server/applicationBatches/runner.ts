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
  LEGACY_APPLICATION_BATCH_TAILORING_PROTOCOL_VERSION,
  type ApplicationBatchTailoringProtocolVersion,
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
        protocolVersion: ApplicationBatchTailoringProtocolVersion;
        delivery: "FINAL" | "DRAFT";
        acceptedTargets: Array<"RESUME" | "COVER">;
        remainingTargets: Array<"RESUME" | "COVER">;
        publishedTargets: Array<"RESUME" | "COVER">;
        remainingPublicationTargets: Array<"RESUME" | "COVER">;
        applicationId: string | null;
        applicationAiContentHash: string | null;
        tailoringRun: { id: string; attemptId: string } | null;
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

async function skipUnsafePendingBatchTasksTx(
  tx: Prisma.TransactionClient,
  input: { userId: string; batchId: string },
): Promise<void> {
  await tx.applicationBatchTask.updateMany({
    where: {
      batchId: input.batchId,
      userId: input.userId,
      status: "PENDING",
      OR: [
        { job: { userId: { not: input.userId } } },
        { job: { market: { not: "AU" } } },
        { job: { status: { not: "NEW" } } },
        {
          AND: [
            { tailoringRun: null },
            {
              job: {
                applications: { some: { userId: input.userId } },
              },
            },
          ],
        },
      ],
    },
    data: {
      status: "SKIPPED",
      completedAt: new Date(),
      error: "Skipped because the Job is no longer safe for a fresh batch",
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

/**
 * Reclaim expired leases from a read path, without paying for a write when
 * there is nothing expired.
 *
 * Reclaim used to happen only inside a claim. That is fine while a Runner is
 * alive, and useless the moment one is not: a Runner killed mid-task left its
 * task RUNNING behind an expired lease, the batch stayed non-terminal, and the
 * only thing that could free it was the very process that had died. The user
 * saw a spinner that no amount of waiting would resolve, and could not queue
 * anything else because a live batch already existed.
 *
 * The `findFirst` guard matters: this runs on a polled GET. Taking the batch
 * advisory lock on every poll would serialise reads behind writes for no
 * reason, so the lock is taken only when an expired lease actually exists.
 *
 * Returns whether anything was reclaimed, so a caller can re-read.
 */
export async function reapExpiredBatchLeases(input: {
  userId: string;
  batchId: string;
  now?: Date;
}): Promise<boolean> {
  const now = input.now ?? new Date();
  const expired = await prisma.applicationBatchTask.findFirst({
    where: {
      batchId: input.batchId,
      userId: input.userId,
      status: "RUNNING",
      completedAt: null,
      OR: [
        { executionLeaseExpiresAt: { lte: now } },
        {
          executionLeaseExpiresAt: null,
          startedAt: { lte: new Date(now.getTime() - STALE_TASK_TIMEOUT_MS) },
        },
      ],
    },
    select: { id: true },
  });
  if (!expired) return false;

  await reclaimStaleBatchTasks(input);
  return true;
}

export async function claimNextBatchTask(input: {
  userId: string;
  batchId: string;
  /** Set when the caller already reclaimed for this run. */
  skipStaleReclaim?: boolean;
  supportedProtocolVersions?: ApplicationBatchTailoringProtocolVersion[];
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

    // Queue eligibility can change while a durable batch is waiting. Recheck
    // at the claim boundary so a later manual Application or status change is
    // preserved instead of being overwritten by a new two-target run.
    await skipUnsafePendingBatchTasksTx(tx, input);

    const candidate = await tx.applicationBatchTask.findFirst({
      where: {
        batchId: input.batchId,
        userId: input.userId,
        status: "PENDING",
        job: { userId: input.userId, market: "AU", status: "NEW" },
        OR: [
          { tailoringRun: { isNot: null } },
          {
            job: {
              applications: { none: { userId: input.userId } },
            },
          },
        ],
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
            id: true,
            status: true,
            attempt: true,
            startedAt: true,
            applicationId: true,
            requiredTargetMask: true,
            acceptedTargetMask: true,
            publicationRequiredTargetMask: true,
            publishedTargetMask: true,
            delivery: true,
            issueKey: true,
            application: {
              select: { aiContentHash: true },
            },
          },
        },
      },
    });

    if (!candidate) return { kind: "empty" as const };

    const executionAttemptId = randomUUID();
    // A bound run owns its protocol forever. In particular, a partially
    // accepted FINAL run must never switch to DRAFT during recovery.
    const protocolVersion: ApplicationBatchTailoringProtocolVersion =
      candidate.tailoringRun?.delivery === "DRAFT"
        ? APPLICATION_BATCH_TAILORING_PROTOCOL_VERSION
        : candidate.tailoringRun
          ? LEGACY_APPLICATION_BATCH_TAILORING_PROTOCOL_VERSION
          : input.supportedProtocolVersions?.includes(
                APPLICATION_BATCH_TAILORING_PROTOCOL_VERSION,
              )
            ? APPLICATION_BATCH_TAILORING_PROTOCOL_VERSION
            : LEGACY_APPLICATION_BATCH_TAILORING_PROTOCOL_VERSION;
    const delivery = protocolVersion === 2 ? ("DRAFT" as const) : ("FINAL" as const);
    const leaseExpiresAt = new Date(Date.now() + TASK_LEASE_MS);
    await tx.applicationBatchTask.update({
      where: {
        id: candidate.id,
      },
      data: {
        status: "RUNNING",
        startedAt: new Date(),
        executionAttemptId,
        executionLeaseExpiresAt: leaseExpiresAt,
        tailoringProtocolVersion: protocolVersion,
        completionAttemptId: null,
        error: null,
      },
    });
    if (candidate.tailoringRun) {
      await acquireTailoringRunLocks(tx, [candidate.tailoringRun.id]);
      await tx.tailoringRun.update({
        where: { id: candidate.tailoringRun.id },
        data: {
          status: "RUNNING",
          executionAttemptId,
          executionLeaseExpiresAt: leaseExpiresAt,
          attempt: { increment: 1 },
          startedAt: candidate.tailoringRun.startedAt ?? new Date(),
          errorCode: null,
          errorMessage: null,
          terminalAt: null,
        },
      });
    }
    const targetProgress = applicationBatchTargetProgress({
      requiredTargetMask: candidate.tailoringRun?.requiredTargetMask,
      acceptedTargetMask: candidate.tailoringRun?.acceptedTargetMask,
      publicationRequiredTargetMask:
        candidate.tailoringRun?.publicationRequiredTargetMask ??
        (protocolVersion === 2 ? 3 : 0),
      publishedTargetMask: candidate.tailoringRun?.publishedTargetMask,
    });

    return {
      kind: "claimed" as const,
      task: {
        id: candidate.id,
        attemptId: executionAttemptId,
        issueKey:
          candidate.tailoringRun?.issueKey ??
          applicationBatchTailoringIssueKey(candidate.id),
        protocolVersion,
        delivery,
        ...targetProgress,
        applicationId: candidate.tailoringRun?.applicationId ?? null,
        applicationAiContentHash:
          candidate.tailoringRun?.application?.aiContentHash ?? null,
        tailoringRun: candidate.tailoringRun
          ? { id: candidate.tailoringRun.id, attemptId: executionAttemptId }
          : null,
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

/**
 * Give a protocol-v2 publication-only task back to the queue immediately.
 *
 * The task retains the released attempt as an idempotency receipt while its
 * TailoringRun is rebound to an unreachable fence token. A late publication
 * from the released worker therefore fails ATTEMPT_STALE, while the next claim
 * can install one fresh shared batch/run attempt without waiting for the
 * normal twenty-minute crash lease.
 */
export async function releaseBatchTask(input: {
  userId: string;
  batchId: string;
  taskId: string;
  attemptId: string;
  reason?: string | null;
}): Promise<{ released: boolean; replayed: boolean }> {
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
        tailoringProtocolVersion: true,
        tailoringRun: {
          select: { id: true, executionAttemptId: true },
        },
      },
    });
    if (!task) throw new BatchRunnerError("NOT_FOUND", "Task not found");
    if (task.tailoringProtocolVersion !== 2 || !task.tailoringRun) {
      throw new BatchRunnerError(
        "INVALID_STATE",
        "Only a bound protocol-v2 task can be released",
      );
    }
    if (task.executionAttemptId !== input.attemptId) {
      throw new BatchRunnerError(
        "INVALID_STATE",
        "Task execution attempt is stale",
      );
    }
    if (task.status === "PENDING") {
      return { released: true, replayed: true };
    }
    if (TERMINAL_TASK_STATUSES.includes(task.status)) {
      return { released: false, replayed: true };
    }
    if (task.status !== "RUNNING") {
      throw new BatchRunnerError("INVALID_STATE", "Task is not running");
    }

    await acquireTailoringRunLocks(tx, [task.tailoringRun.id]);
    if (task.tailoringRun.executionAttemptId !== input.attemptId) {
      throw new BatchRunnerError(
        "INVALID_STATE",
        "Tailoring execution attempt is stale",
      );
    }
    const fenceAttemptId = randomUUID();
    await tx.tailoringRun.update({
      where: { id: task.tailoringRun.id },
      data: {
        status: "RUNNING",
        executionAttemptId: fenceAttemptId,
        executionLeaseExpiresAt: null,
      },
    });
    await tx.applicationBatchTask.update({
      where: { id: task.id },
      data: {
        status: "PENDING",
        startedAt: null,
        completedAt: null,
        executionAttemptId: input.attemptId,
        executionLeaseExpiresAt: null,
        completionAttemptId: null,
        error: safeTaskError(input.reason ?? "Publication settlement deferred"),
      },
    });
    return { released: true, replayed: false };
  });
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
  if (outcome.kind === "profile_missing") {
    throw new BatchRunnerError(
      "INVALID_STATE",
      "Create and save your Master Resume Profile before retrying this batch",
    );
  }
  if (outcome.kind === "empty") {
    throw new BatchRunnerError("INVALID_STATE", "No failed tasks to retry");
  }
  return {
    batch: outcome.batch,
    sourceBatchId: outcome.sourceBatchId ?? input.sourceBatchId,
  };
}
