import type {
  ApplicationBatchStatus,
  ApplicationBatchTaskStatus,
} from "@/lib/generated/prisma";
import { prisma } from "@/lib/server/prisma";

const TERMINAL_BATCH_STATUSES: ApplicationBatchStatus[] = ["SUCCEEDED", "FAILED", "CANCELLED"];

const TERMINAL_TASK_STATUSES: ApplicationBatchTaskStatus[] = ["SUCCEEDED", "FAILED", "SKIPPED"];
const STALE_TASK_TIMEOUT_MS = (() => {
  const parsed = Number(process.env.APPLICATION_BATCH_TASK_STALE_MS);
  if (!Number.isFinite(parsed) || parsed <= 0) return 20 * 60 * 1000;
  return Math.max(parsed, 60_000);
})();

export class BatchRunnerError extends Error {
  code: "NOT_FOUND" | "INVALID_STATE";

  constructor(code: "NOT_FOUND" | "INVALID_STATE", message: string) {
    super(message);
    this.code = code;
  }
}

export type BatchProgress = {
  pending: number;
  running: number;
  succeeded: number;
  failed: number;
  skipped: number;
};

type ClaimResult =
  | {
      kind: "claimed";
      task: {
        id: string;
        jobId: string;
        title: string;
        company: string | null;
        jobUrl: string;
      };
    }
  | { kind: "done"; batchStatus: ApplicationBatchStatus; progress: BatchProgress }
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

function toProgress(rows: Array<{ status: ApplicationBatchTaskStatus; _count: { _all: number } }>) {
  const progress: BatchProgress = {
    pending: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
  };
  for (const row of rows) {
    if (row.status === "PENDING") progress.pending = row._count._all;
    if (row.status === "RUNNING") progress.running = row._count._all;
    if (row.status === "SUCCEEDED") progress.succeeded = row._count._all;
    if (row.status === "FAILED") progress.failed = row._count._all;
    if (row.status === "SKIPPED") progress.skipped = row._count._all;
  }
  return progress;
}

export async function getBatchProgress(input: { userId: string; batchId: string }) {
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
  return toProgress(grouped);
}

async function reconcileBatchStatus(input: { userId: string; batchId: string }) {
  const [batch, grouped] = await Promise.all([
    prisma.applicationBatch.findFirst({
      where: {
        id: input.batchId,
        userId: input.userId,
      },
      select: {
        id: true,
        status: true,
        startedAt: true,
        completedAt: true,
      },
    }),
    prisma.applicationBatchTask.groupBy({
      by: ["status"],
      where: {
        batchId: input.batchId,
        userId: input.userId,
      },
      _count: {
        _all: true,
      },
    }),
  ]);

  if (!batch) throw new BatchRunnerError("NOT_FOUND", "Batch not found");

  const progress = toProgress(grouped);

  let nextStatus: ApplicationBatchStatus = batch.status;
  if (progress.pending > 0 || progress.running > 0) {
    nextStatus = "RUNNING";
  } else if (progress.failed > 0) {
    nextStatus = "FAILED";
  } else if (progress.succeeded > 0 || progress.skipped > 0) {
    nextStatus = "SUCCEEDED";
  }

  if (TERMINAL_BATCH_STATUSES.includes(batch.status)) {
    return { batchStatus: batch.status, progress };
  }

  const shouldComplete = nextStatus === "SUCCEEDED" || nextStatus === "FAILED";
  const batchError =
    nextStatus === "FAILED"
      ? (
          await prisma.applicationBatchTask.findFirst({
            where: {
              batchId: input.batchId,
              userId: input.userId,
              status: "FAILED",
            },
            orderBy: {
              updatedAt: "desc",
            },
            select: {
              error: true,
            },
          })
        )?.error ?? "One or more tasks failed."
      : null;

  await prisma.applicationBatch.update({
    where: {
      id: batch.id,
    },
    data: {
      status: nextStatus,
      startedAt: batch.startedAt ?? new Date(),
      completedAt: shouldComplete ? batch.completedAt ?? new Date() : null,
      error: nextStatus === "FAILED" ? batchError : null,
    },
  });

  return { batchStatus: nextStatus, progress };
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
  await prisma.applicationBatchTask.updateMany({
    where: {
      batchId: input.batchId,
      userId: input.userId,
      status: "RUNNING",
      completedAt: null,
      startedAt: {
        lte: new Date(Date.now() - STALE_TASK_TIMEOUT_MS),
      },
    },
    data: {
      status: "PENDING",
      startedAt: null,
      completedAt: null,
      error: "Task reclaimed after stale RUNNING timeout",
      attempt: {
        increment: 1,
      },
    },
  });
}

export async function claimNextBatchTask(input: {
  userId: string;
  batchId: string;
  /** Set when the caller already reclaimed for this run. */
  skipStaleReclaim?: boolean;
}): Promise<ClaimResult> {
  const batch = await prisma.applicationBatch.findFirst({
    where: {
      id: input.batchId,
      userId: input.userId,
    },
    select: {
      id: true,
      status: true,
    },
  });

  if (!batch) return { kind: "not_found" };
  if (TERMINAL_BATCH_STATUSES.includes(batch.status)) {
    return { kind: "terminal", batchStatus: batch.status };
  }

  if (batch.status === "QUEUED") {
    await prisma.applicationBatch.updateMany({
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
    await reclaimStaleBatchTasks({ userId: input.userId, batchId: input.batchId });
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = await prisma.applicationBatchTask.findFirst({
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
      },
    });

    if (!candidate) {
      const reconciled = await reconcileBatchStatus(input);
      return { kind: "done", batchStatus: reconciled.batchStatus, progress: reconciled.progress };
    }

    const locked = await prisma.applicationBatchTask.updateMany({
      where: {
        id: candidate.id,
        status: "PENDING",
      },
      data: {
        status: "RUNNING",
        startedAt: new Date(),
        error: null,
      },
    });

    if (locked.count === 1) {
      return {
        kind: "claimed",
        task: {
          id: candidate.id,
          jobId: candidate.jobId,
          title: candidate.job.title,
          company: candidate.job.company,
          jobUrl: candidate.job.jobUrl,
        },
      };
    }
  }

  const reconciled = await reconcileBatchStatus(input);
  return { kind: "done", batchStatus: reconciled.batchStatus, progress: reconciled.progress };
}

export async function completeBatchTask(input: {
  userId: string;
  batchId: string;
  taskId: string;
  status: Extract<ApplicationBatchTaskStatus, "SUCCEEDED" | "FAILED" | "SKIPPED">;
  error?: string | null;
}) {
  const task = await prisma.applicationBatchTask.findFirst({
    where: {
      id: input.taskId,
      batchId: input.batchId,
      userId: input.userId,
    },
    select: {
      id: true,
      status: true,
    },
  });
  if (!task) throw new BatchRunnerError("NOT_FOUND", "Task not found");

  if (task.status !== "RUNNING") {
    if (TERMINAL_TASK_STATUSES.includes(task.status) && task.status === input.status) {
      const reconciled = await reconcileBatchStatus({ userId: input.userId, batchId: input.batchId });
      return {
        taskStatus: task.status,
        batchStatus: reconciled.batchStatus,
        progress: reconciled.progress,
      };
    }
    throw new BatchRunnerError("INVALID_STATE", "Task is not running");
  }

  await prisma.applicationBatchTask.update({
    where: {
      id: task.id,
    },
    data: {
      status: input.status,
      error: input.status === "FAILED" ? input.error?.trim() || "TASK_FAILED" : null,
      completedAt: new Date(),
    },
  });

  const reconciled = await reconcileBatchStatus({ userId: input.userId, batchId: input.batchId });

  return {
    taskStatus: input.status,
    batchStatus: reconciled.batchStatus,
    progress: reconciled.progress,
  };
}

export async function cancelBatch(input: { userId: string; batchId: string }) {
  const batch = await prisma.applicationBatch.findFirst({
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
    return {
      batchStatus: batch.status,
      progress: await getBatchProgress(input),
      alreadyTerminal: true,
    };
  }

  await prisma.$transaction([
    prisma.applicationBatch.update({
      where: { id: batch.id },
      data: {
        status: "CANCELLED",
        error: "Cancelled by user",
        completedAt: new Date(),
      },
    }),
    prisma.applicationBatchTask.updateMany({
      where: {
        batchId: batch.id,
        userId: input.userId,
        status: "PENDING",
      },
      data: {
        status: "SKIPPED",
        error: "Cancelled by user",
        completedAt: new Date(),
      },
    }),
  ]);

  return {
    batchStatus: "CANCELLED" as const,
    progress: await getBatchProgress(input),
    alreadyTerminal: false,
  };
}

export async function createRetryBatchFromFailed(input: {
  userId: string;
  sourceBatchId: string;
  limit?: number;
}): Promise<RetryBatchResult> {
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 200);

  const source = await prisma.applicationBatch.findFirst({
    where: {
      id: input.sourceBatchId,
      userId: input.userId,
    },
    select: {
      id: true,
    },
  });
  if (!source) throw new BatchRunnerError("NOT_FOUND", "Batch not found");

  const active = await prisma.applicationBatch.findFirst({
    where: {
      userId: input.userId,
      status: {
        in: ["QUEUED", "RUNNING"],
      },
    },
    select: {
      id: true,
    },
  });
  if (active) throw new BatchRunnerError("INVALID_STATE", "Active batch already exists");

  const failedTasks = await prisma.applicationBatchTask.findMany({
    where: {
      batchId: source.id,
      userId: input.userId,
      status: "FAILED",
    },
    orderBy: {
      updatedAt: "desc",
    },
    distinct: ["jobId"],
    take: limit,
    select: {
      jobId: true,
    },
  });
  if (failedTasks.length === 0) {
    throw new BatchRunnerError("INVALID_STATE", "No failed tasks to retry");
  }

  const batch = await prisma.$transaction(async (tx) => {
    const created = await tx.applicationBatch.create({
      data: {
        userId: input.userId,
        scope: "NEW",
        status: "QUEUED",
        totalCount: failedTasks.length,
      },
      select: {
        id: true,
        scope: true,
        status: true,
        totalCount: true,
        createdAt: true,
      },
    });

    await tx.applicationBatchTask.createMany({
      data: failedTasks.map((task) => ({
        batchId: created.id,
        userId: input.userId,
        jobId: task.jobId,
        status: "PENDING",
      })),
      skipDuplicates: true,
    });

    return created;
  });

  return {
    batch,
    sourceBatchId: source.id,
  };
}
