import type { ApplicationBatchStatus, Prisma } from "@/lib/generated/prisma";
import { acquireJobMutationLock } from "@/lib/server/jobs/jobMutationLock";
import { prisma } from "@/lib/server/prisma";
import {
  boundedApplicationBatchLimit,
  hasAuMasterResumeProfile,
  selectSafeNewBatchCandidates,
} from "./batchEligibility";

const ACTIVE_BATCH_STATUSES = ["QUEUED", "RUNNING"] as const;
const MAX_CREATE_ATTEMPTS = 2;

export type ApplicationBatchSeed =
  | {
      kind: "new";
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
  | { kind: "profile_missing" }
  | { kind: "source_not_found" };

async function findNewJobIds(
  tx: Prisma.TransactionClient,
  input: Extract<ApplicationBatchSeed, { kind: "new" }> & { userId: string },
): Promise<string[]> {
  const candidates = await selectSafeNewBatchCandidates(tx, input);
  return candidates.map((candidate) => candidate.id);
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
      // Retrying creates a new task and therefore a new two-target
      // TailoringRun. Do not let it overwrite a document or draft that was
      // accepted (or manually created) after the source task failed.
      job: {
        userId: input.userId,
        market: "AU",
        status: "NEW",
        applications: { none: { userId: input.userId } },
      },
    },
    orderBy: { updatedAt: "desc" },
    distinct: ["jobId"],
    take: boundedApplicationBatchLimit(input.limit),
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

        if (!(await hasAuMasterResumeProfile(tx, input.userId))) {
          return { kind: "profile_missing" as const };
        }

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
