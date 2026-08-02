import { randomUUID } from "node:crypto";

import { Prisma } from "@/lib/generated/prisma";
import type { FitPromptPayload } from "@/lib/server/applications/applicationPrompt";
import { prescreenJobFit } from "@/lib/server/ai/fitPrescreen";
import { buildPromptSnapshotHash } from "@/lib/server/ai/promptContract";
import { verdictForScore } from "@/lib/server/ai/fitScoring";
import { buildResumePromptSnapshot } from "@/lib/server/ai/resumePromptSnapshot";
import { acquireJobMutationLock } from "@/lib/server/jobs/jobMutationLock";
import { prisma } from "@/lib/server/prisma";
import { getResumeProfile } from "@/lib/server/resumeProfile";
import { marketStringToResumeLocale } from "@/lib/shared/market";

/**
 * Server-side fit scoring center. The queue IS the database: an unscored job
 * is `status NEW AND fitScoredAt IS NULL`, and writing a score dequeues it.
 * That makes the whole scan idempotent, resumable after any refresh, and
 * independent of whatever the browser happens to have loaded.
 */

export const FIT_BATCH_SIZE = 15;
export const FIT_CLAIM_LEASE_MS = 5 * 60 * 1_000;
export const FIT_CLAIM_RETRY_AFTER_MS = 5_000;
export const FIT_CLAIM_HEARTBEAT_AFTER_MS = 60_000;
export const FIT_BATCH_CLAIM_PROTOCOL_VERSION = 2 as const;

const FIT_CLAIM_PREFIX = "claim:";
const FIT_CLAIM_LOCK_NAMESPACE = 0x4a4f4246; // "JOBF"
const FIT_PRESCREEN_TRANSACTION_TIMEOUT_MS = 30_000;
const HASH_PATTERN = /^[a-f0-9]{64}$/;

export type FitBatchClaimErrorCode =
  | "FIT_CLAIM_NOT_FOUND"
  | "FIT_CLAIM_EXPIRED"
  | "FIT_ATTEMPT_STALE"
  | "FIT_CLAIM_MISMATCH"
  | "FIT_PROMPT_MISMATCH";

export class FitBatchClaimError extends Error {
  constructor(
    public readonly code: FitBatchClaimErrorCode,
    message: string,
    public readonly status = 409,
  ) {
    super(message);
    this.name = "FitBatchClaimError";
  }
}

export function fitClaimSource(claimToken: string): string {
  return `${FIT_CLAIM_PREFIX}${claimToken}`;
}

function stableInt32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash | 0;
}

type FitTransaction = Prisma.TransactionClient;

/**
 * JOBF serializes one user's durable Fit claims. Callers that also touch Job
 * rows must acquire JOBJ first; this helper is intentionally separate so a
 * heartbeat can renew only the Claim without taking the broader Job lock.
 */
export async function acquireFitClaimLock(
  tx: FitTransaction,
  userId: string,
): Promise<void> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      ${FIT_CLAIM_LOCK_NAMESPACE}::integer,
      ${stableInt32(userId)}::integer
    )
  `;
}

async function acquireJobThenFitLocks(
  tx: FitTransaction,
  userId: string,
): Promise<void> {
  await acquireJobMutationLock(tx, userId);
  await acquireFitClaimLock(tx, userId);
}

function canonicalJobIds(jobIds: readonly string[]): string[] {
  return [...new Set(jobIds)].sort();
}

function exactJobSet(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  const left = canonicalJobIds(actual);
  const right = canonicalJobIds(expected);
  return (
    left.length === right.length &&
    left.every((jobId, index) => jobId === right[index])
  );
}

function claimLeaseExpiresAt(now: Date): Date {
  return new Date(now.getTime() + FIT_CLAIM_LEASE_MS);
}

function promptReceiptHashes(issued: FitPromptPayload) {
  const binding = issued.snapshotBinding;
  if (
    !HASH_PATTERN.test(issued.issueKey) ||
    !HASH_PATTERN.test(issued.promptMeta.promptHash) ||
    !binding ||
    !HASH_PATTERN.test(binding.resumeSnapshotHash) ||
    !HASH_PATTERN.test(binding.jobSnapshotHash)
  ) {
    throw new FitBatchClaimError(
      "FIT_PROMPT_MISMATCH",
      "The Fit prompt is missing its durable snapshot receipt.",
    );
  }
  const promptMetaHash = buildPromptSnapshotHash(issued.promptMeta);
  return {
    promptHash: issued.promptMeta.promptHash,
    promptMetaHash,
    resumeProfileId: binding.resumeProfileId,
    resumeSnapshotHash: binding.resumeSnapshotHash,
    jobSetHash: binding.jobSnapshotHash,
    issueHash: buildPromptSnapshotHash({
      protocol: "fit-batch-claim/v2",
      issueKey: issued.issueKey,
      promptMetaHash,
      resumeSnapshotHash: binding.resumeSnapshotHash,
      jobSetHash: binding.jobSnapshotHash,
    }),
  };
}

function claimableFitWhere(
  userId: string,
  staleBefore: Date,
): Prisma.JobWhereInput {
  void staleBefore;
  return {
    userId,
    status: "NEW",
    fitScoredAt: null,
    OR: [
      { fitSource: null },
      { fitSource: { not: { startsWith: FIT_CLAIM_PREFIX } } },
    ],
  };
}

/** Rolling-deploy adapter for discovering pre-FitBatchClaim leases only. */
function staleLegacyFitWhere(
  userId: string,
  staleBefore: Date,
): Prisma.JobWhereInput {
  return {
    userId,
    status: "NEW",
    fitScoredAt: null,
    fitSource: { startsWith: FIT_CLAIM_PREFIX },
    updatedAt: { lt: staleBefore },
  };
}

function pendingFitWhere(userId: string): Prisma.JobWhereInput {
  return {
    userId,
    status: "NEW",
    fitScoredAt: null,
  };
}

function leasedFitWhere(
  userId: string,
  staleBefore: Date,
): Prisma.JobWhereInput {
  return {
    ...pendingFitWhere(userId),
    fitSource: { startsWith: FIT_CLAIM_PREFIX },
    updatedAt: { gte: staleBefore },
  };
}

const FIT_PROFILE_SCOPES = [
  { locale: "en-AU" as const, markets: ["AU", "GLOBAL"] },
  { locale: "zh-CN" as const, markets: ["CN"] },
] as const;

export async function getCurrentFitSnapshotPredicates(
  userId: string,
): Promise<Prisma.JobWhereInput[]> {
  const predicates: Prisma.JobWhereInput[] = [];
  for (const scope of FIT_PROFILE_SCOPES) {
    const profile = await getResumeProfile(userId, { locale: scope.locale });
    if (!profile) continue;
    predicates.push({
      market: { in: [...scope.markets] },
      fitSnapshotHash: profile.updatedAt.toISOString(),
    });
  }
  return predicates;
}

export type FitRunStats = {
  /** All NEW jobs for the user. */
  total: number;
  /** NEW jobs with a score or a terminal failed mark. */
  scored: number;
  /** NEW jobs still waiting for prescreen/AI. */
  pending: number;
};

export type FitRunCancellation = FitRunStats & {
  /** Pending and claimed jobs terminally cancelled by this command. */
  cancelled: number;
};

export async function getFitRunStats(userId: string): Promise<FitRunStats> {
  const [total, pending] = await Promise.all([
    prisma.job.count({ where: { userId, status: "NEW" } }),
    prisma.job.count({ where: { userId, status: "NEW", fitScoredAt: null } }),
  ]);
  return { total, scored: total - pending, pending };
}

/**
 * Cancel the user's current Fit scan at the database queue boundary.
 *
 * The same per-user lock used by `nextFitBatch` linearizes cancellation with
 * leasing. Marking every unscored row terminal makes the status projection
 * immediately report no pending work; a later explicit run resets these rows
 * and can score them again.
 */
export async function cancelFitRun(
  userId: string,
): Promise<FitRunCancellation> {
  return prisma.$transaction(async (tx) => {
    await acquireJobThenFitLocks(tx, userId);

    const now = new Date();
    const activeClaim = await tx.fitBatchClaim.findFirst({
      where: { userId, status: "ACTIVE" },
      select: { id: true },
    });
    const result = await tx.job.updateMany({
      where: pendingFitWhere(userId),
      data: {
        fitScore: null,
        fitVerdict: null,
        fitEligibility: null,
        fitMatrix: Prisma.DbNull,
        fitSource: "cancelled",
        fitScoredAt: now,
        fitSnapshotHash: null,
      },
    });
    if (activeClaim) {
      await tx.fitBatchClaimItem.updateMany({
        where: { claimId: activeClaim.id, outcome: null },
        data: {
          outcome: "FAILED",
          failureCode: "FIT_CANCELLED",
          releasedAt: now,
        },
      });
      await tx.fitBatchClaim.update({
        where: { id: activeClaim.id },
        data: {
          status: "CANCELLED",
          executionLeaseExpiresAt: null,
          errorCode: "FIT_CANCELLED",
          errorMessage: "Cancelled by user",
          terminalAt: now,
        },
      });
    }
    const total = await tx.job.count({
      where: { userId, status: "NEW" },
    });
    const pending = await tx.job.count({
      where: pendingFitWhere(userId),
    });

    return {
      cancelled: result.count,
      total,
      scored: total - pending,
      pending,
    };
  });
}

/** Explicitly starting a new scan retries terminally failed or cancelled work. */
export async function resetFailedFitBatches(userId: string): Promise<number> {
  return prisma.$transaction(async (tx) => {
    await acquireJobThenFitLocks(tx, userId);
    const result = await tx.job.updateMany({
      where: {
        userId,
        status: "NEW",
        fitSource: { in: ["failed", "cancelled"] },
      },
      data: {
        fitScore: null,
        fitVerdict: null,
        fitEligibility: null,
        fitSource: null,
        fitScoredAt: null,
        fitSnapshotHash: null,
      },
    });
    return result.count;
  });
}

/**
 * A saved score is valid only for the resume snapshot used to produce it.
 * Re-queue stale rows when a profile changes, instead of continuing to sort
 * and bulk-delete jobs using evidence the candidate has already replaced.
 */
export async function invalidateStaleFitScores(
  userId: string,
): Promise<number> {
  let invalidated = 0;
  for (const scope of FIT_PROFILE_SCOPES) {
    const profile = await getResumeProfile(userId, { locale: scope.locale });
    const snapshotVersion = profile?.updatedAt.toISOString() ?? null;
    const result = await prisma.$transaction(async (tx) => {
      await acquireJobThenFitLocks(tx, userId);
      return tx.job.updateMany({
        where: {
          userId,
          status: "NEW",
          market: { in: [...scope.markets] },
          fitScoredAt: { not: null },
          ...(snapshotVersion
            ? {
                OR: [
                  { fitSnapshotHash: null },
                  { fitSnapshotHash: { not: snapshotVersion } },
                ],
              }
            : {}),
        },
        data: {
          fitScore: null,
          fitVerdict: null,
          fitEligibility: null,
          fitMatrix: Prisma.DbNull,
          fitSource: null,
          fitScoredAt: null,
          fitSnapshotHash: null,
        },
      });
    });
    invalidated += result.count;
  }
  return invalidated;
}

/**
 * Deterministic prescreen across ALL unscored NEW jobs: obvious mismatches are
 * banded POOR without an AI run. Returns how many were dequeued this way.
 */
export type SelectedFitPrescreen = {
  poor: Array<{ jobId: string; score: number; verdict: string }>;
  needAi: string[];
};

type FitPrescreenResume = {
  text: string;
  snapshotVersion: string;
};

async function loadFitPrescreenResumes(
  userId: string,
): Promise<Map<string, FitPrescreenResume | null>> {
  const entries = await Promise.all(
    FIT_PROFILE_SCOPES.map(async ({ locale }) => {
      const profile = await getResumeProfile(userId, { locale });
      return [
        locale,
        profile
          ? {
              text: JSON.stringify(buildResumePromptSnapshot(profile)),
              snapshotVersion: profile.updatedAt.toISOString(),
            }
          : null,
      ] as const;
    }),
  );
  return new Map(entries);
}

async function prescreenEligibleFitJobs(
  userId: string,
  requestedJobIds?: readonly string[],
): Promise<SelectedFitPrescreen> {
  const canonicalRequestedIds = requestedJobIds
    ? [...new Set(requestedJobIds)]
    : null;
  const staleBefore = new Date(Date.now() - FIT_CLAIM_LEASE_MS);
  const [resumeByLocale, jobs] = await Promise.all([
    loadFitPrescreenResumes(userId),
    prisma.job.findMany({
      where: {
        ...claimableFitWhere(userId, staleBefore),
        ...(canonicalRequestedIds ? { id: { in: canonicalRequestedIds } } : {}),
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        description: true,
        market: true,
        updatedAt: true,
      },
    }),
  ]);
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  const orderedJobs = canonicalRequestedIds
    ? canonicalRequestedIds.flatMap((jobId) => {
        const job = jobsById.get(jobId);
        return job ? [job] : [];
      })
    : jobs;

  const poorCandidates: Array<{
    jobId: string;
    jobUpdatedAt: Date;
    score: number;
    verdict: string;
    snapshotVersion: string;
  }> = [];
  const needAiCandidates: Array<{ jobId: string; jobUpdatedAt: Date }> = [];
  for (const job of orderedJobs) {
    const resume = resumeByLocale.get(marketStringToResumeLocale(job.market));
    if (!resume) continue;
    const outcome = prescreenJobFit({
      jobDescription: job.description,
      resumeText: resume.text,
    });
    if (outcome.decision === "poor") {
      poorCandidates.push({
        jobId: job.id,
        jobUpdatedAt: job.updatedAt,
        score: outcome.result.score,
        verdict: verdictForScore(outcome.result.score),
        snapshotVersion: resume.snapshotVersion,
      });
    } else if (canonicalRequestedIds) {
      needAiCandidates.push({
        jobId: job.id,
        jobUpdatedAt: job.updatedAt,
      });
    }
  }
  if (poorCandidates.length === 0 && needAiCandidates.length === 0) {
    return { poor: [], needAi: [] };
  }

  return prisma.$transaction(
    async (tx) => {
      await acquireJobThenFitLocks(tx, userId);
      // `fitSource` is only a rolling-deploy projection. Re-check the durable
      // aggregate under JOBF so a released Claim (or a drifted projection)
      // cannot be prescreened out from under its immutable composition.
      const activeClaim = await tx.fitBatchClaim.findFirst({
        where: { userId, status: "ACTIVE" },
        select: { items: { select: { jobId: true } } },
      });
      const protectedJobIds = new Set(
        activeClaim?.items.map((item) => item.jobId) ?? [],
      );
      const poor: SelectedFitPrescreen["poor"] = [];
      const now = new Date();
      for (const candidate of poorCandidates) {
        if (protectedJobIds.has(candidate.jobId)) continue;
        const write = await tx.job.updateMany({
          where: {
            ...claimableFitWhere(userId, staleBefore),
            id: candidate.jobId,
            updatedAt: candidate.jobUpdatedAt,
          },
          data: {
            fitScore: candidate.score,
            fitVerdict: candidate.verdict,
            fitEligibility: null,
            fitSource: "prescreen",
            fitScoredAt: now,
            fitSnapshotHash: candidate.snapshotVersion,
          },
        });
        if (write.count === 1) {
          poor.push({
            jobId: candidate.jobId,
            score: candidate.score,
            verdict: candidate.verdict,
          });
        }
      }

      let needAi: string[] = [];
      const unclaimedNeedAiCandidates = needAiCandidates.filter(
        (candidate) => !protectedJobIds.has(candidate.jobId),
      );
      if (unclaimedNeedAiCandidates.length > 0) {
        const stillEligible = await tx.job.findMany({
          where: {
            AND: [
              claimableFitWhere(userId, staleBefore),
              {
                OR: unclaimedNeedAiCandidates.map((candidate) => ({
                  id: candidate.jobId,
                  updatedAt: candidate.jobUpdatedAt,
                })),
              },
            ],
          },
          select: { id: true },
        });
        const eligibleIds = new Set(stillEligible.map((job) => job.id));
        needAi = unclaimedNeedAiCandidates
          .map((candidate) => candidate.jobId)
          .filter((jobId) => eligibleIds.has(jobId));
      }
      return { poor, needAi };
    },
    { timeout: FIT_PRESCREEN_TRANSACTION_TIMEOUT_MS },
  );
}

export async function prescreenSelectedFitJobs(
  userId: string,
  jobIds: readonly string[],
): Promise<SelectedFitPrescreen> {
  return prescreenEligibleFitJobs(userId, jobIds);
}

export async function prescreenAllUnscored(
  userId: string,
): Promise<{ prescreened: number }> {
  const result = await prescreenEligibleFitJobs(userId);
  return { prescreened: result.poor.length };
}

export type ClaimedFitBatch = {
  jobIds: string[];
  /** Pending jobs after excluding the batch returned to this caller. */
  remaining: number;
  /** Every unscored NEW job, including rows currently leased by another scan. */
  pendingTotal: number;
  /** Pending rows protected by a fresh claim, including this response's batch. */
  leased: number;
  /** Poll hint when no batch is available but leased work still exists. */
  retryAfterMs: number | null;
  /** Legacy alias retained for the current Runner. */
  claimToken: string | null;
  /** Durable authority added by protocol v2. */
  claimId: string | null;
  attemptId: string | null;
};

type FitClaimHandle = {
  id: string;
  attemptId: string;
  issueKey: string | null;
};

type FitPromptClaimRequest = {
  claimId?: string;
  attemptId?: string;
};

type FitPromptBindResult =
  | {
      state: "BOUND";
      payload: FitPromptPayload & { fitClaim: FitClaimHandle | null };
    }
  | { state: "SUPERSEDED" };

async function pendingAndLegacyLeased(
  tx: FitTransaction,
  userId: string,
  staleBefore: Date,
) {
  const pendingTotal = await tx.job.count({ where: pendingFitWhere(userId) });
  const legacyLeased = await tx.job.count({
    where: leasedFitWhere(userId, staleBefore),
  });
  return { pendingTotal, legacyLeased };
}

async function supersedeUnavailableClaim(
  tx: FitTransaction,
  claim: {
    id: string;
    executionAttemptId: string;
    items: Array<{ jobId: string }>;
  },
  userId: string,
  now: Date,
) {
  await tx.job.updateMany({
    where: {
      id: { in: claim.items.map((item) => item.jobId) },
      userId,
      status: "NEW",
      fitScoredAt: null,
      fitSource: fitClaimSource(claim.executionAttemptId),
    },
    data: { fitSource: null },
  });
  await tx.fitBatchClaimItem.updateMany({
    where: { claimId: claim.id, outcome: null },
    data: {
      outcome: "FAILED",
      failureCode: "JOB_UNAVAILABLE",
      releasedAt: now,
    },
  });
  await tx.fitBatchClaim.update({
    where: { id: claim.id },
    data: {
      status: "SUPERSEDED",
      executionLeaseExpiresAt: null,
      errorCode: "JOB_UNAVAILABLE",
      errorMessage: "One or more claimed Jobs are no longer eligible.",
      terminalAt: now,
    },
  });
}

/**
 * Atomically lease the next batch. The per-user advisory lock makes
 * select-and-claim serial across tabs and serverless instances.
 */
export async function nextFitBatch(userId: string): Promise<ClaimedFitBatch> {
  return prisma.$transaction(async (tx) => {
    await acquireJobThenFitLocks(tx, userId);

    const now = new Date();
    const staleBefore = new Date(now.getTime() - FIT_CLAIM_LEASE_MS);
    let activeClaim = await tx.fitBatchClaim.findFirst({
      where: { userId, status: "ACTIVE" },
      include: {
        items: {
          orderBy: { ordinal: "asc" },
          select: { jobId: true, ordinal: true },
        },
      },
    });

    if (
      activeClaim &&
      activeClaim.executionLeaseExpiresAt &&
      activeClaim.executionLeaseExpiresAt > now
    ) {
      const { pendingTotal } = await pendingAndLegacyLeased(
        tx,
        userId,
        staleBefore,
      );
      return {
        jobIds: [],
        remaining: pendingTotal,
        pendingTotal,
        leased: activeClaim.items.length,
        retryAfterMs: FIT_CLAIM_RETRY_AFTER_MS,
        claimToken: null,
        claimId: null,
        attemptId: null,
      };
    }

    if (activeClaim) {
      const itemJobIds = activeClaim.items.map((item) => item.jobId);
      const eligible = await tx.job.findMany({
        where: {
          id: { in: itemJobIds },
          userId,
          status: "NEW",
          fitScoredAt: null,
        },
        select: { id: true },
      });
      if (eligible.length !== itemJobIds.length) {
        await supersedeUnavailableClaim(tx, activeClaim, userId, now);
        activeClaim = null;
      } else {
        const attemptId = randomUUID();
        const leaseExpiresAt = claimLeaseExpiresAt(now);
        await tx.fitBatchClaim.update({
          where: { id: activeClaim.id },
          data: {
            executionAttemptId: attemptId,
            executionLeaseExpiresAt: leaseExpiresAt,
            lastHeartbeatAt: now,
            attempt: { increment: 1 },
            errorCode: null,
            errorMessage: null,
          },
        });
        await tx.job.updateMany({
          where: {
            id: { in: itemJobIds },
            userId,
            status: "NEW",
            fitScoredAt: null,
          },
          data: { fitSource: fitClaimSource(attemptId) },
        });
        const { pendingTotal } = await pendingAndLegacyLeased(
          tx,
          userId,
          staleBefore,
        );
        return {
          jobIds: itemJobIds,
          remaining: Math.max(pendingTotal - itemJobIds.length, 0),
          pendingTotal,
          leased: itemJobIds.length,
          retryAfterMs: null,
          claimToken: attemptId,
          claimId: activeClaim.id,
          attemptId,
        };
      }
    }

    // A still-live v1 lease has no FitBatchClaim row but remains authoritative
    // until its five-minute window closes. Do not start overlapping durable
    // work for the same user during rolling deployment.
    const freshLegacyLease = await tx.job.findFirst({
      where: leasedFitWhere(userId, staleBefore),
      select: { id: true },
    });
    if (freshLegacyLease) {
      const { pendingTotal, legacyLeased } = await pendingAndLegacyLeased(
        tx,
        userId,
        staleBefore,
      );
      return {
        jobIds: [],
        remaining: pendingTotal,
        pendingTotal,
        leased: legacyLeased,
        retryAfterMs: FIT_CLAIM_RETRY_AFTER_MS,
        claimToken: null,
        claimId: null,
        attemptId: null,
      };
    }

    // During rolling deployment, recover one expired v1 `claim:<token>` as an
    // exact group before touching ordinary pending work. Mixing those rows with
    // newer unclaimed Jobs would orphan the local Runner's original issue and
    // silently change batch composition during cutover.
    const legacySeed = await tx.job.findFirst({
      where: staleLegacyFitWhere(userId, staleBefore),
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { fitSource: true },
    });
    const ordinaryWhere = claimableFitWhere(userId, staleBefore);
    let claimWhere: Prisma.JobWhereInput = ordinaryWhere;
    let candidateWindow: Array<{ id: string; market: string }> = [];

    if (legacySeed?.fitSource) {
      const legacyWhere: Prisma.JobWhereInput = {
        userId,
        status: "NEW",
        fitScoredAt: null,
        fitSource: legacySeed.fitSource,
      };
      const legacyGroup = await tx.job.findMany({
        where: legacyWhere,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: FIT_BATCH_SIZE + 1,
        select: { id: true, market: true },
      });
      const groupLocale = legacyGroup[0]
        ? marketStringToResumeLocale(legacyGroup[0].market)
        : null;
      const validLegacyGroup =
        legacyGroup.length > 0 &&
        legacyGroup.length <= FIT_BATCH_SIZE &&
        legacyGroup.every(
          (job) => marketStringToResumeLocale(job.market) === groupLocale,
        );
      if (validLegacyGroup) {
        candidateWindow = legacyGroup;
        claimWhere = legacyWhere;
      } else {
        // Invalid historical projections cannot form one prompt. Release them
        // under both locks so they re-enter ordinary deterministic batching.
        await tx.job.updateMany({
          where: legacyWhere,
          data: { fitSource: null },
        });
      }
    }

    if (candidateWindow.length === 0) {
      candidateWindow = await tx.job.findMany({
        where: ordinaryWhere,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: FIT_BATCH_SIZE,
        select: { id: true, market: true },
      });
    }

    if (candidateWindow.length === 0) {
      const { pendingTotal, legacyLeased } = await pendingAndLegacyLeased(
        tx,
        userId,
        staleBefore,
      );
      return {
        jobIds: [],
        remaining: pendingTotal,
        pendingTotal,
        leased: legacyLeased,
        retryAfterMs:
          pendingTotal > 0 || legacyLeased > 0
            ? FIT_CLAIM_RETRY_AFTER_MS
            : null,
        claimToken: null,
        claimId: null,
        attemptId: null,
      };
    }

    // A triage prompt has one resume snapshot. AU and GLOBAL share en-AU;
    // CN uses zh-CN. Never lease a mixed-locale batch and accidentally score
    // Chinese jobs against the English profile (or vice versa).
    const batchLocale = marketStringToResumeLocale(
      candidateWindow[0]?.market ?? "AU",
    );
    const candidates = candidateWindow.filter(
      (job) => marketStringToResumeLocale(job.market) === batchLocale,
    );
    const attemptId = randomUUID();
    const claimSource = fitClaimSource(attemptId);
    const claimedRows = await tx.job.updateManyAndReturn({
      where: {
        ...claimWhere,
        id: { in: candidates.map((job) => job.id) },
      },
      data: { fitSource: claimSource },
      select: { id: true },
    });
    const claimed = new Set(claimedRows.map((job) => job.id));
    const jobIds = canonicalJobIds(
      candidates.map((job) => job.id).filter((id) => claimed.has(id)),
    );
    let claimId: string | null = null;
    if (jobIds.length > 0) {
      const claim = await tx.fitBatchClaim.create({
        data: {
          userId,
          status: "ACTIVE",
          protocolVersion: FIT_BATCH_CLAIM_PROTOCOL_VERSION,
          executionAttemptId: attemptId,
          executionLeaseExpiresAt: claimLeaseExpiresAt(now),
          lastHeartbeatAt: now,
          items: {
            create: jobIds.map((jobId, ordinal) => ({ jobId, ordinal })),
          },
        },
        select: { id: true },
      });
      claimId = claim.id;
    }
    const pendingTotal = await tx.job.count({
      where: pendingFitWhere(userId),
    });

    return {
      jobIds,
      remaining: Math.max(pendingTotal - jobIds.length, 0),
      pendingTotal,
      leased: jobIds.length,
      retryAfterMs:
        jobIds.length === 0 && pendingTotal > 0
          ? FIT_CLAIM_RETRY_AFTER_MS
          : null,
      claimToken: jobIds.length > 0 ? attemptId : null,
      claimId,
      attemptId: jobIds.length > 0 ? attemptId : null,
    };
  });
}

export async function bindFitBatchPrompt(
  userId: string,
  jobIds: string[],
  issued: FitPromptPayload,
  requestedClaim: FitPromptClaimRequest = {},
): Promise<FitPromptPayload & { fitClaim: FitClaimHandle | null }> {
  const requestedJobIds = canonicalJobIds(jobIds);
  const receipt = promptReceiptHashes(issued);
  const result: FitPromptBindResult = await prisma.$transaction(async (tx) => {
    await acquireJobThenFitLocks(tx, userId);
    const claim = await tx.fitBatchClaim.findFirst({
      where: { userId, status: "ACTIVE" },
      include: {
        items: {
          orderBy: { ordinal: "asc" },
          select: { jobId: true },
        },
      },
    });
    // Rolling compatibility: a v1 Runner may still hold a claim:<uuid> lease
    // created before FitBatchClaim existed. Its settlement stays on the v1
    // fallback until the old lease drains.
    if (!claim) {
      if (requestedClaim.claimId || requestedClaim.attemptId) {
        const owned = requestedClaim.claimId
          ? await tx.fitBatchClaim.findFirst({
              where: { id: requestedClaim.claimId, userId },
              select: { status: true },
            })
          : null;
        throw new FitBatchClaimError(
          owned ? "FIT_CLAIM_EXPIRED" : "FIT_CLAIM_NOT_FOUND",
          owned
            ? "The requested Fit Claim is no longer active."
            : "The requested Fit Claim was not found.",
          owned ? 409 : 404,
        );
      }
      return { state: "BOUND", payload: { ...issued, fitClaim: null } };
    }
    if (requestedClaim.claimId && requestedClaim.claimId !== claim.id) {
      throw new FitBatchClaimError(
        "FIT_CLAIM_MISMATCH",
        "The prompt request does not own the active Fit Claim.",
      );
    }
    if (
      requestedClaim.attemptId &&
      requestedClaim.attemptId !== claim.executionAttemptId
    ) {
      throw new FitBatchClaimError(
        "FIT_ATTEMPT_STALE",
        "The Fit Claim attempt has been superseded.",
      );
    }
    if (
      !exactJobSet(
        claim.items.map((item) => item.jobId),
        requestedJobIds,
      )
    ) {
      throw new FitBatchClaimError(
        "FIT_CLAIM_MISMATCH",
        "The Fit prompt must use the Claim's exact Job set.",
      );
    }
    if (
      !claim.executionLeaseExpiresAt ||
      claim.executionLeaseExpiresAt <= new Date()
    ) {
      throw new FitBatchClaimError(
        "FIT_CLAIM_EXPIRED",
        "The Fit Claim lease expired before prompt issuance.",
      );
    }

    if (claim.issueKey) {
      if (
        claim.issueKey !== issued.issueKey ||
        claim.issueHash !== receipt.issueHash ||
        claim.promptHash !== receipt.promptHash ||
        claim.promptMetaHash !== receipt.promptMetaHash
      ) {
        const now = new Date();
        await tx.job.updateMany({
          where: {
            id: { in: claim.items.map((item) => item.jobId) },
            userId,
            status: "NEW",
            fitScoredAt: null,
            fitSource: fitClaimSource(claim.executionAttemptId),
          },
          data: { fitSource: null },
        });
        await tx.fitBatchClaimItem.updateMany({
          where: { claimId: claim.id, outcome: null },
          data: {
            outcome: "FAILED",
            failureCode: "PROMPT_SUPERSEDED",
            releasedAt: now,
          },
        });
        await tx.fitBatchClaim.update({
          where: { id: claim.id },
          data: {
            status: "SUPERSEDED",
            executionLeaseExpiresAt: null,
            errorCode: "PROMPT_SUPERSEDED",
            errorMessage:
              "The immutable Fit prompt receipt changed after issuance.",
            terminalAt: now,
          },
        });
        return { state: "SUPERSEDED" };
      }
    } else {
      await tx.fitBatchClaim.update({
        where: { id: claim.id },
        data: {
          issueKey: issued.issueKey,
          issueHash: receipt.issueHash,
          promptHash: receipt.promptHash,
          promptMetaHash: receipt.promptMetaHash,
          promptMeta: issued.promptMeta as Prisma.InputJsonValue,
          resumeProfileId: receipt.resumeProfileId,
          resumeSnapshotHash: receipt.resumeSnapshotHash,
          jobSetHash: receipt.jobSetHash,
        },
      });
    }

    return {
      state: "BOUND",
      payload: {
        ...issued,
        fitClaim: {
          id: claim.id,
          attemptId: claim.executionAttemptId,
          issueKey: issued.issueKey,
        },
      },
    };
  });
  if (result.state === "SUPERSEDED") {
    throw new FitBatchClaimError(
      "FIT_PROMPT_MISMATCH",
      "The immutable Fit prompt receipt changed; the Claim was superseded and released.",
    );
  }
  return result.payload;
}

export async function heartbeatFitBatchClaim(input: {
  userId: string;
  claimId: string;
  attemptId: string;
}) {
  return prisma.$transaction(async (tx) => {
    await acquireFitClaimLock(tx, input.userId);
    const now = new Date();
    const leaseExpiresAt = claimLeaseExpiresAt(now);
    const renewed = await tx.fitBatchClaim.updateMany({
      where: {
        id: input.claimId,
        userId: input.userId,
        status: "ACTIVE",
        executionAttemptId: input.attemptId,
        executionLeaseExpiresAt: { gt: now },
      },
      data: {
        executionLeaseExpiresAt: leaseExpiresAt,
        lastHeartbeatAt: now,
      },
    });
    if (renewed.count !== 1) {
      const owned = await tx.fitBatchClaim.findFirst({
        where: { id: input.claimId, userId: input.userId },
        select: {
          status: true,
          executionAttemptId: true,
          executionLeaseExpiresAt: true,
        },
      });
      if (!owned) {
        throw new FitBatchClaimError(
          "FIT_CLAIM_NOT_FOUND",
          "Fit Claim not found.",
          404,
        );
      }
      if (owned.executionAttemptId !== input.attemptId) {
        throw new FitBatchClaimError(
          "FIT_ATTEMPT_STALE",
          "The Fit Claim attempt has been superseded.",
        );
      }
      throw new FitBatchClaimError(
        "FIT_CLAIM_EXPIRED",
        "The Fit Claim is no longer active.",
      );
    }
    return {
      claimId: input.claimId,
      attemptId: input.attemptId,
      leaseExpiresAt,
      heartbeatAfterMs: FIT_CLAIM_HEARTBEAT_AFTER_MS,
    };
  });
}

/**
 * Dequeue jobs whose AI batch failed terminally so the pump cannot loop on
 * them forever. They keep a null score (rendered as unscored) but carry a
 * "failed" source and a timestamp; a future rescan can clear and retry them.
 */
export async function markFitBatchFailed(
  userId: string,
  jobIds: string[],
  claimToken: string,
): Promise<number> {
  return prisma.$transaction(async (tx) => {
    await acquireJobThenFitLocks(tx, userId);
    const claim = await tx.fitBatchClaim.findFirst({
      where: { userId, executionAttemptId: claimToken },
      include: {
        items: {
          orderBy: { ordinal: "asc" },
          select: { jobId: true, outcome: true },
        },
      },
    });
    if (!claim) {
      const legacy = await tx.job.updateMany({
        where: {
          id: { in: jobIds },
          userId,
          status: "NEW",
          fitScoredAt: null,
          fitSource: fitClaimSource(claimToken),
        },
        data: { fitSource: "failed", fitScoredAt: new Date() },
      });
      return legacy.count;
    }
    const claimedJobIds = claim.items.map((item) => item.jobId);
    if (!exactJobSet(claimedJobIds, jobIds)) {
      throw new FitBatchClaimError(
        "FIT_CLAIM_MISMATCH",
        "Failure must reference the Claim's exact Job set.",
      );
    }
    if (claim.status === "SETTLED" || claim.status === "FAILED") {
      return claim.items.filter((item) => item.outcome === "FAILED").length;
    }
    if (claim.status !== "ACTIVE") {
      throw new FitBatchClaimError(
        "FIT_CLAIM_EXPIRED",
        "The Fit Claim is already cancelled or superseded.",
      );
    }
    const now = new Date();
    if (
      !claim.executionLeaseExpiresAt ||
      claim.executionLeaseExpiresAt <= now
    ) {
      throw new FitBatchClaimError(
        "FIT_CLAIM_EXPIRED",
        "The Fit Claim lease expired before failure settlement.",
      );
    }

    await tx.job.updateMany({
      where: {
        id: { in: claimedJobIds },
        userId,
        status: "NEW",
        fitScoredAt: null,
      },
      data: { fitSource: "failed", fitScoredAt: now },
    });
    await tx.fitBatchClaimItem.updateMany({
      where: { claimId: claim.id, outcome: null },
      data: {
        outcome: "FAILED",
        failureCode: "MODEL_FAILED",
        releasedAt: now,
      },
    });
    await tx.fitBatchClaim.update({
      where: { id: claim.id },
      data: {
        status: "FAILED",
        executionLeaseExpiresAt: null,
        errorCode: "MODEL_FAILED",
        errorMessage: "The Fit model could not produce a valid result.",
        terminalAt: now,
      },
    });
    return claimedJobIds.length;
  });
}

/**
 * Release a live lease so retry is immediate. Durable membership remains
 * authoritative and its v1 `claim:*` projection stays fenced until takeover
 * rotates the attempt; only a truly legacy lease is cleared back to pending.
 */
export async function releaseFitBatchClaim(
  userId: string,
  jobIds: string[],
  claimToken: string,
): Promise<number> {
  return prisma.$transaction(async (tx) => {
    await acquireJobThenFitLocks(tx, userId);
    const claim = await tx.fitBatchClaim.findFirst({
      where: { userId, executionAttemptId: claimToken },
      include: {
        items: { orderBy: { ordinal: "asc" }, select: { jobId: true } },
      },
    });
    if (!claim) {
      const legacy = await tx.job.updateMany({
        where: {
          id: { in: jobIds },
          userId,
          status: "NEW",
          fitScoredAt: null,
          fitSource: fitClaimSource(claimToken),
        },
        data: { fitSource: null },
      });
      return legacy.count;
    }
    const claimedJobIds = claim.items.map((item) => item.jobId);
    if (!exactJobSet(claimedJobIds, jobIds)) {
      throw new FitBatchClaimError(
        "FIT_CLAIM_MISMATCH",
        "Release must reference the Claim's exact Job set.",
      );
    }
    if (claim.status !== "ACTIVE") return 0;
    await tx.fitBatchClaim.update({
      where: { id: claim.id },
      data: {
        executionLeaseExpiresAt: null,
        errorCode: null,
        errorMessage: null,
      },
    });
    return claimedJobIds.length;
  });
}
