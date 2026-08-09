import type { ApplicationBatchStatus, Prisma } from "@/lib/generated/prisma";
import { prisma } from "@/lib/server/prisma";

export const DEFAULT_APPLICATION_BATCH_LIMIT = 100;
export const MAX_APPLICATION_BATCH_LIMIT = 200;

const ACTIVE_BATCH_STATUSES = ["QUEUED", "RUNNING"] as const;

type BatchEligibilityClient = Prisma.TransactionClient | typeof prisma;

export type SafeNewBatchCandidate = {
  id: string;
};

export function boundedApplicationBatchLimit(
  limit: number | undefined,
): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_APPLICATION_BATCH_LIMIT;
  }
  return Math.min(Math.max(Math.floor(limit), 1), MAX_APPLICATION_BATCH_LIMIT);
}

function ownedAuNewWhere(userId: string): Prisma.JobWhereInput {
  return { userId, market: "AU", status: "NEW" };
}

function completeApplicationWhere(
  userId: string,
): Prisma.ApplicationWhereInput {
  return {
    userId,
    resumePdfUrl: { not: null },
    coverPdfUrl: { not: null },
  };
}

/**
 * The one safe selector shared by preflight and fresh batch creation.
 *
 * Fresh batches are deliberately narrower than "missing one PDF". A new
 * BatchTask starts a new TailoringRun whose contract requires both Resume and
 * Cover, so admitting any existing Application could overwrite a document or
 * draft that the user already accepted. Until a missing-target mask is durable
 * end-to-end, only Jobs with no user Application are safe to enqueue.
 */
export async function selectSafeNewBatchCandidates(
  client: BatchEligibilityClient,
  input: {
    userId: string;
    limit?: number;
  },
): Promise<SafeNewBatchCandidate[]> {
  const maxJobs = boundedApplicationBatchLimit(input.limit);
  const jobs = await client.job.findMany({
    where: {
      ...ownedAuNewWhere(input.userId),
      applications: {
        none: { userId: input.userId },
      },
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    take: maxJobs,
    select: {
      id: true,
    },
  });

  return jobs;
}

export async function hasAuMasterResumeProfile(
  client: BatchEligibilityClient,
  userId: string,
): Promise<boolean> {
  const profile = await client.resumeProfile.findFirst({
    where: { userId, locale: "en-AU" },
    select: { id: true },
  });
  return Boolean(profile);
}

export async function getApplicationBatchPreflight(input: {
  userId: string;
  limit?: number;
}) {
  const maxJobs = boundedApplicationBatchLimit(input.limit);
  const baseWhere = ownedAuNewWhere(input.userId);
  const completeWhere = completeApplicationWhere(input.userId);

  const [
    profileReady,
    activeBatch,
    candidates,
    ready,
    incomplete,
    alreadyGenerated,
  ] = await Promise.all([
    hasAuMasterResumeProfile(prisma, input.userId),
    prisma.applicationBatch.findFirst({
      where: {
        userId: input.userId,
        status: { in: [...ACTIVE_BATCH_STATUSES] },
      },
      select: { id: true, status: true, totalCount: true },
      orderBy: { createdAt: "desc" },
    }),
    selectSafeNewBatchCandidates(prisma, {
      userId: input.userId,
      limit: maxJobs,
    }),
    prisma.job.count({
      where: {
        ...baseWhere,
        applications: { none: { userId: input.userId } },
      },
    }),
    prisma.job.count({
      where: {
        ...baseWhere,
        applications: {
          some: { userId: input.userId },
          none: completeWhere,
        },
      },
    }),
    prisma.job.count({
      where: {
        ...baseWhere,
        applications: { some: completeWhere },
      },
    }),
  ]);

  const safeTotal = ready;
  return {
    scope: "NEW" as const,
    eligibleCount: candidates.length,
    maxJobs,
    profileReady,
    activeBatch: activeBatch
      ? {
          id: activeBatch.id,
          status: activeBatch.status as Extract<
            ApplicationBatchStatus,
            "QUEUED" | "RUNNING"
          >,
          totalCount: activeBatch.totalCount,
        }
      : null,
    ready,
    incomplete,
    alreadyGenerated,
    eligibleTotal: safeTotal,
    safeTotal,
    totalNew: ready + incomplete + alreadyGenerated,
    capped: safeTotal > candidates.length,
  };
}
