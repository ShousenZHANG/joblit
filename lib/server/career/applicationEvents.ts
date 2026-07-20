import type { JobStatus, Prisma } from "@/lib/generated/prisma";
import { prisma } from "@/lib/server/prisma";
import { canTransitionJobStatus } from "@/lib/shared/jobStatus";
import { CareerConflictError, CareerNotFoundError } from "./errors";

type EventInput = {
  jobId: string;
  applicationId?: string;
  type:
    | "STATUS_CHANGED"
    | "NOTE_ADDED"
    | "INTERVIEW_PLANNED"
    | "INTERVIEW_COMPLETED"
    | "OFFER_RECORDED"
    | "OFFER_UPDATED"
    | "OFFER_DECIDED"
    | "FOLLOW_UP_CREATED"
    | "FOLLOW_UP_COMPLETED";
  source: "USER" | "EXTENSION" | "SYSTEM" | "IMPORT";
  toStatus?: JobStatus;
  expectedFromStatus?: JobStatus;
  note?: string;
  metadata?: Prisma.InputJsonValue;
  idempotencyKey?: string;
  occurredAt?: Date | null;
};

const CAREER_LOCK_NAMESPACE = 0x4a4f4243; // JOBC

function stableInt32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash | 0;
}

async function acquireCareerLock(
  tx: Prisma.TransactionClient,
  userId: string,
  jobId: string,
) {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      ${CAREER_LOCK_NAMESPACE}::integer,
      ${stableInt32(`${userId}:${jobId}`)}::integer
    )
  `;
}

export function isAllowedStatusTransition(from: JobStatus, to: JobStatus): boolean {
  return canTransitionJobStatus(from, to);
}

export async function appendApplicationEvent(userId: string, input: EventInput) {
  return prisma.$transaction(
    async (tx) => {
      await acquireCareerLock(tx, userId, input.jobId);

      if (input.idempotencyKey) {
        const replay = await tx.applicationEvent.findUnique({
          where: {
            userId_idempotencyKey: {
              userId,
              idempotencyKey: input.idempotencyKey,
            },
          },
        });
        if (replay) {
          const sameRequest =
            replay.jobId === input.jobId &&
            replay.applicationId === (input.applicationId ?? null) &&
            replay.type === input.type &&
            replay.source === input.source &&
            replay.toStatus === (input.toStatus ?? null) &&
            replay.note === (input.note ?? null);
          if (!sameRequest) {
            throw new CareerConflictError(
              "IDEMPOTENCY_KEY_REUSED",
              "Idempotency key was already used for a different event",
            );
          }
          return { event: replay, replayed: true };
        }
      }

      const job = await tx.job.findFirst({
        where: { id: input.jobId, userId },
        select: { id: true, status: true, company: true, title: true },
      });
      if (!job) throw new CareerNotFoundError("job");

      if (input.applicationId) {
        const application = await tx.application.findFirst({
          where: { id: input.applicationId, userId },
          select: { id: true, jobId: true },
        });
        if (!application || application.jobId !== job.id) {
          throw new CareerNotFoundError("application");
        }
      }

      let fromStatus: JobStatus | undefined;
      if (input.type === "STATUS_CHANGED") {
        if (!input.toStatus) {
          throw new CareerConflictError("STATUS_REQUIRED", "toStatus is required");
        }
        fromStatus = job.status;
        if (input.expectedFromStatus && input.expectedFromStatus !== job.status) {
          throw new CareerConflictError(
            "STALE_STATUS",
            `Job status changed from ${input.expectedFromStatus} to ${job.status}`,
          );
        }
        if (!isAllowedStatusTransition(job.status, input.toStatus)) {
          throw new CareerConflictError(
            "INVALID_STATUS_TRANSITION",
            `Cannot move job from ${job.status} to ${input.toStatus}`,
          );
        }
      }

      const event = await tx.applicationEvent.create({
        data: {
          userId,
          jobId: job.id,
          companySnapshot: job.company,
          titleSnapshot: job.title,
          applicationId: input.applicationId,
          type: input.type,
          source: input.source,
          fromStatus,
          toStatus: input.type === "STATUS_CHANGED" ? input.toStatus : undefined,
          note: input.note,
          metadata: input.metadata,
          idempotencyKey: input.idempotencyKey,
          occurredAt: input.occurredAt ?? undefined,
        },
      });

      if (input.type === "STATUS_CHANGED" && input.toStatus) {
        await tx.job.update({
          where: { id: job.id },
          data: { status: input.toStatus },
        });
      }

      return { event, replayed: false };
    },
    { isolationLevel: "Serializable", timeout: 15_000 },
  );
}

export async function listApplicationEvents(
  userId: string,
  options: { jobId?: string; cursor?: string; limit?: number },
) {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  return prisma.applicationEvent.findMany({
    where: { userId, ...(options.jobId ? { jobId: options.jobId } : {}) },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take: limit,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  });
}

/**
 * Atomically append one status event per row won by a bulk projection update.
 * `updateManyAndReturn` is the concurrency boundary: only rows still matching
 * `fromStatus` are changed and receive ledger entries. Any event write failure
 * rolls the projection update back with the transaction.
 */
export async function bulkAppendStatusEvents(
  userId: string,
  input: {
    where: Prisma.JobWhereInput;
    fromStatus: JobStatus;
    toStatus: JobStatus;
    source: "USER" | "EXTENSION" | "SYSTEM" | "IMPORT";
    note: string;
    idempotencyPrefix: string;
    projectionUpdatedAt?: Date;
  },
) {
  if (!isAllowedStatusTransition(input.fromStatus, input.toStatus)) {
    throw new CareerConflictError(
      "INVALID_STATUS_TRANSITION",
      `Cannot move jobs from ${input.fromStatus} to ${input.toStatus}`,
    );
  }

  return prisma.$transaction(
    async (tx) => {
      const jobs = await tx.job.updateManyAndReturn({
        where: {
          AND: [
            input.where,
            {
              userId,
              status: input.fromStatus,
            },
          ],
        },
        data: {
          status: input.toStatus,
          updatedAt: input.projectionUpdatedAt,
        },
        select: { id: true, company: true, title: true },
      });
      if (jobs.length === 0) return { count: 0 };

      await tx.applicationEvent.createMany({
        data: jobs.map((job) => ({
          userId,
          jobId: job.id,
          companySnapshot: job.company,
          titleSnapshot: job.title,
          type: "STATUS_CHANGED" as const,
          source: input.source,
          fromStatus: input.fromStatus,
          toStatus: input.toStatus,
          note: input.note,
          idempotencyKey: `${input.idempotencyPrefix}:${job.id}`,
        })),
      });
      return { count: jobs.length };
    },
    { isolationLevel: "Serializable", timeout: 30_000 },
  );
}
