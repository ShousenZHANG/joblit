import { acquireJobMutationLock } from "@/lib/server/jobs/jobMutationLock";
import { acquireApplicationBatchLock } from "@/lib/server/tailoringRuns/tailoringRunLock";
import { prisma } from "@/lib/server/prisma";
import { hasAuMasterResumeProfile } from "./batchEligibility";

const ACTIVE_BATCH_STATUSES = ["QUEUED", "RUNNING"] as const;

/** Bounds one request, not the queue. The queue itself is unbounded by design. */
export const MAX_ENQUEUE_JOBS_PER_REQUEST = 50;

export type EnqueueJobsOutcome =
  | {
      kind: "enqueued";
      batchId: string;
      /** Jobs that became new PENDING tasks in this call. */
      queuedJobIds: string[];
      /** Already queued or running in the live batch; asking again is a no-op. */
      alreadyQueuedJobIds: string[];
      /** Not safe to tailor: wrong market, not NEW, or already has an Application. */
      ineligibleJobIds: string[];
    }
  | {
      kind: "none_eligible";
      ineligibleJobIds: string[];
    }
  | { kind: "profile_missing" }
  | { kind: "empty" };

/**
 * Add specific Jobs to the user's tailoring queue, creating the queue if it
 * does not exist yet.
 *
 * This replaces "queue everything eligible, but only if nothing is running".
 * That shape forced a decision the user did not have the information to make —
 * commit to a hundred Jobs at once, or wait for a run to finish before they
 * could ask for the one Job they were actually looking at. Asking for one Job
 * is the natural unit; the batch is an implementation detail of how the Runner
 * drains it, and should not be something the user schedules around.
 *
 * Lock order is JOBJ then BATCH. Nothing in the codebase takes them the other
 * way round — the batch lock is held alone by the claim, reconcile, and
 * acceptance paths — so this introduces no cycle. Both are needed: JOBJ
 * serializes against Job deletion so eligibility cannot straddle it, and BATCH
 * serializes against the reconcile that could otherwise terminalize the batch
 * between the read and the insert, stranding a PENDING task nothing will claim.
 *
 * Re-asking for a Job already in the queue is not an error. The unique index on
 * (batchId, jobId) makes the insert idempotent, and a user who taps twice
 * deserves the same answer both times.
 */
export async function enqueueJobsForTailoring(input: {
  userId: string;
  jobIds: string[];
}): Promise<EnqueueJobsOutcome> {
  const requested = Array.from(new Set(input.jobIds)).slice(
    0,
    MAX_ENQUEUE_JOBS_PER_REQUEST,
  );
  if (requested.length === 0) return { kind: "empty" };

  return prisma.$transaction(async (tx) => {
    await acquireJobMutationLock(tx, input.userId);

    if (!(await hasAuMasterResumeProfile(tx, input.userId))) {
      return { kind: "profile_missing" as const };
    }

    // Same safety rule as a fresh batch: a task starts a two-target
    // TailoringRun, so a Job that already has an Application could have an
    // accepted document overwritten. Until a missing-target mask is durable,
    // only Jobs with no Application at all are safe.
    const eligible = await tx.job.findMany({
      where: {
        id: { in: requested },
        userId: input.userId,
        market: "AU",
        status: "NEW",
        applications: { none: { userId: input.userId } },
      },
      select: { id: true },
    });
    const eligibleIds = eligible.map((job) => job.id);
    const eligibleSet = new Set(eligibleIds);
    const ineligibleJobIds = requested.filter((id) => !eligibleSet.has(id));

    if (eligibleIds.length === 0) {
      // A distinct kind rather than an "enqueued" result with no batch: a
      // caller reading `batchId` off an empty success would watch a batch that
      // does not exist, and the UI would spin on nothing.
      return { kind: "none_eligible" as const, ineligibleJobIds };
    }

    const existing = await tx.applicationBatch.findFirst({
      where: {
        userId: input.userId,
        status: { in: [...ACTIVE_BATCH_STATUSES] },
      },
      select: { id: true },
      orderBy: { createdAt: "desc" },
    });

    let batchId: string;
    if (existing) {
      batchId = existing.id;
      await acquireApplicationBatchLock(tx, batchId);
      // Re-read under the batch lock. Between the read above and here a
      // reconcile could have terminalized it, and appending to a finished
      // batch would enqueue work nothing is going to claim.
      const stillActive = await tx.applicationBatch.findFirst({
        where: {
          id: batchId,
          userId: input.userId,
          status: { in: [...ACTIVE_BATCH_STATUSES] },
        },
        select: { id: true },
      });
      if (!stillActive) {
        const created = await tx.applicationBatch.create({
          data: {
            userId: input.userId,
            scope: "NEW",
            status: "QUEUED",
            totalCount: 0,
          },
          select: { id: true },
        });
        batchId = created.id;
        await acquireApplicationBatchLock(tx, batchId);
      }
    } else {
      const created = await tx.applicationBatch.create({
        data: {
          userId: input.userId,
          scope: "NEW",
          status: "QUEUED",
          totalCount: 0,
        },
        select: { id: true },
      });
      batchId = created.id;
      await acquireApplicationBatchLock(tx, batchId);
    }

    const alreadyPresent = await tx.applicationBatchTask.findMany({
      where: { batchId, userId: input.userId, jobId: { in: eligibleIds } },
      select: { jobId: true },
    });
    const alreadyQueuedJobIds = alreadyPresent.map((task) => task.jobId);
    const alreadySet = new Set(alreadyQueuedJobIds);
    const queuedJobIds = eligibleIds.filter((id) => !alreadySet.has(id));

    if (queuedJobIds.length > 0) {
      await tx.applicationBatchTask.createMany({
        data: queuedJobIds.map((jobId) => ({
          batchId,
          userId: input.userId,
          jobId,
          status: "PENDING" as const,
        })),
        // Belt and braces against a concurrent enqueue that won the race for
        // the same Job. The count below is derived from a re-count, not from
        // this call's optimism, so a skipped row cannot inflate the header.
        skipDuplicates: true,
      });
    }

    // totalCount drives every progress readout, so derive it rather than
    // incrementing. An increment that raced would leave the banner counting
    // toward a total the batch never had.
    const totalCount = await tx.applicationBatchTask.count({
      where: { batchId, userId: input.userId },
    });
    await tx.applicationBatch.update({
      where: { id: batchId },
      data: { totalCount },
    });

    return {
      kind: "enqueued" as const,
      batchId,
      queuedJobIds,
      alreadyQueuedJobIds,
      ineligibleJobIds,
    };
  });
}
