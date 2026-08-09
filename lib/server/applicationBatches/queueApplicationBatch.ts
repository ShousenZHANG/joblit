import type { ApplicationBatchStatus, Prisma } from "@/lib/generated/prisma";
import { acquireJobMutationLock } from "@/lib/server/jobs/jobMutationLock";
import { prisma } from "@/lib/server/prisma";

const ACTIVE_BATCH_STATUSES = ["QUEUED", "RUNNING"] as const;
const DEFAULT_BATCH_LIMIT = 100;
const MAX_BATCH_LIMIT = 200;
const MAX_CREATE_ATTEMPTS = 2;

export type ApplicationBatchSeed =
  | {
      kind: "new";
      selectedJobIds?: readonly string[];
      limit?: number;
    }
  | {
      kind: "retry_failed";
      sourceBatchId: string;
      limit?: number;
    };

type QueuedBatch = {
  id: string;
  scope: "NEW";
  status: "QUEUED";
  totalCount: number;
  createdAt: Date;
};

export type QueueApplicationBatchOutcome =
  | {
      kind: "queued";
      batch: QueuedBatch;
      sourceBatchId?: string;
    }
  | {
      kind: "active_exists";
      activeBatch: {
        id: string;
        status: Extract<ApplicationBatchStatus, "QUEUED" | "RUNNING">;
      };
    }
  | {
      kind: "empty";
      reason: "NO_ELIGIBLE_JOBS" | "NO_FAILED_TASKS";
    }
  | { kind: "source_not_found" };

function boundedLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_BATCH_LIMIT;
  }
  return Math.min(Math.max(Math.floor(limit), 1), MAX_BATCH_LIMIT);
}

async function findNewJobIds(
  tx: Prisma.TransactionClient,
  input: Extract<ApplicationBatchSeed, { kind: "new" }> & { userId: string },
): Promise<string[]> {
  const selectedJobIds = Array.from(new Set(input.selectedJobIds ?? [])).slice(
    0,
    MAX_BATCH_LIMIT,
  );
  const jobs = await tx.job.findMany({
    where: {
      userId: input.userId,
      market: "AU",
      status: "NEW",
      ...(selectedJobIds.length > 0 ? { id: { in: selectedJobIds } } : {}),
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    ...(selectedJobIds.length === 0 ? { take: boundedLimit(input.limit) } : {}),
    select: { id: true },
  });
  return jobs.map((job) => job.id);
}

async function findFailedJobIds(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    sourceBatchId: string;
    limit?: number;
  },
): Promise<string[]> {
  const failedTasks = await tx.applicationBatchTask.findMany({
    where: {
      batchId: input.sourceBatchId,
      userId: input.userId,
      status: "FAILED",
      job: { market: "AU" },
    },
    orderBy: { updatedAt: "desc" },
    distinct: ["jobId"],
    take: boundedLimit(input.limit),
    select: { jobId: true },
  });
  return failedTasks.map((task) => task.jobId);
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

class ActiveBatchCreateConflict extends Error {
  readonly original: unknown;

  constructor(original: unknown) {
    super("Concurrent Application Batch creation lost the active-batch race");
    this.original = original;
  }
}

function activeExistsOutcome(activeBatch: {
  id: string;
  status: ApplicationBatchStatus;
}): Extract<QueueApplicationBatchOutcome, { kind: "active_exists" }> {
  return {
    kind: "active_exists",
    activeBatch: {
      id: activeBatch.id,
      status: activeBatch.status as Extract<
        ApplicationBatchStatus,
        "QUEUED" | "RUNNING"
      >,
    },
  };
}

/**
 * Queue either a fresh or retry Application Batch behind one transaction.
 *
 * The per-user Job mutation lock is deliberately the transaction's first
 * statement. It serializes both queue modes with permanent Job deletion, so
 * candidate selection and task insertion cannot straddle a deleted Job. It
 * also serializes every in-repo batch creator for the single-active invariant.
 */
export async function queueApplicationBatch(input: {
  userId: string;
  seed: ApplicationBatchSeed;
}): Promise<QueueApplicationBatchOutcome> {
  let lastCreateConflict: unknown;

  for (
    let createAttempt = 1;
    createAttempt <= MAX_CREATE_ATTEMPTS;
    createAttempt += 1
  ) {
    try {
      return await prisma.$transaction(async (tx) => {
        await acquireJobMutationLock(tx, input.userId);

        if (input.seed.kind === "retry_failed") {
          const source = await tx.applicationBatch.findFirst({
            where: {
              id: input.seed.sourceBatchId,
              userId: input.userId,
            },
            select: { id: true },
          });
          if (!source) return { kind: "source_not_found" as const };
        }

        const activeBatch = await tx.applicationBatch.findFirst({
          where: {
            userId: input.userId,
            status: { in: [...ACTIVE_BATCH_STATUSES] },
          },
          select: { id: true, status: true },
          orderBy: { createdAt: "desc" },
        });
        if (activeBatch) return activeExistsOutcome(activeBatch);

        const jobIds =
          input.seed.kind === "new"
            ? await findNewJobIds(tx, {
                ...input.seed,
                userId: input.userId,
              })
            : await findFailedJobIds(tx, {
                userId: input.userId,
                sourceBatchId: input.seed.sourceBatchId,
                limit: input.seed.limit,
              });

        if (jobIds.length === 0) {
          return {
            kind: "empty" as const,
            reason:
              input.seed.kind === "new"
                ? ("NO_ELIGIBLE_JOBS" as const)
                : ("NO_FAILED_TASKS" as const),
          };
        }

        let created: { id: string; totalCount: number; createdAt: Date };
        try {
          created = await tx.applicationBatch.create({
            data: {
              userId: input.userId,
              scope: "NEW",
              status: "QUEUED",
              totalCount: jobIds.length,
            },
            select: {
              id: true,
              totalCount: true,
              createdAt: true,
            },
          });
        } catch (error) {
          // The raw partial unique index is not represented in Prisma's schema.
          // A mixed deployment can therefore race an older writer that does not
          // take JOBJ; translate only the header create collision after rollback.
          if (isUniqueConstraintError(error)) {
            throw new ActiveBatchCreateConflict(error);
          }
          throw error;
        }
        const inserted = await tx.applicationBatchTask.createMany({
          data: jobIds.map((jobId) => ({
            batchId: created.id,
            userId: input.userId,
            jobId,
            status: "PENDING" as const,
          })),
        });
        if (inserted.count !== jobIds.length) {
          // No duplicate is legitimate inside a brand-new batch. Failing the
          // transaction is safer than returning a header whose count lies.
          throw new Error(
            "Application batch task count did not match its header",
          );
        }

        return {
          kind: "queued" as const,
          batch: {
            id: created.id,
            scope: "NEW" as const,
            status: "QUEUED" as const,
            totalCount: created.totalCount,
            createdAt: created.createdAt,
          },
          ...(input.seed.kind === "retry_failed"
            ? { sourceBatchId: input.seed.sourceBatchId }
            : {}),
        };
      });
    } catch (error) {
      if (!(error instanceof ActiveBatchCreateConflict)) throw error;
      lastCreateConflict = error.original;

      const activeBatch = await prisma.applicationBatch.findFirst({
        where: {
          userId: input.userId,
          status: { in: [...ACTIVE_BATCH_STATUSES] },
        },
        select: { id: true, status: true },
        orderBy: { createdAt: "desc" },
      });
      if (activeBatch) return activeExistsOutcome(activeBatch);

      // The winning mixed-deploy writer can terminalize or delete its batch
      // before this post-rollback read. Retry the fully locked operation once
      // so that a transient uniqueness race never escapes as an HTTP 500.
    }
  }

  throw lastCreateConflict;
}
