import { randomUUID } from "node:crypto";

import { Prisma } from "@/lib/generated/prisma";
import { prescreenJobFit } from "@/lib/server/ai/fitPrescreen";
import { verdictForScore } from "@/lib/server/ai/fitScoring";
import { buildResumePromptSnapshot } from "@/lib/server/ai/resumePromptSnapshot";
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

const FIT_CLAIM_PREFIX = "claim:";
const FIT_CLAIM_LOCK_NAMESPACE = 0x4a4f4246; // "JOBF"

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

function claimableFitWhere(userId: string, staleBefore: Date): Prisma.JobWhereInput {
  return {
    userId,
    status: "NEW",
    fitScoredAt: null,
    OR: [
      { fitSource: null },
      { fitSource: { not: { startsWith: FIT_CLAIM_PREFIX } } },
      {
        fitSource: { startsWith: FIT_CLAIM_PREFIX },
        updatedAt: { lt: staleBefore },
      },
    ],
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

export async function getFitRunStats(userId: string): Promise<FitRunStats> {
  const [total, pending] = await Promise.all([
    prisma.job.count({ where: { userId, status: "NEW" } }),
    prisma.job.count({ where: { userId, status: "NEW", fitScoredAt: null } }),
  ]);
  return { total, scored: total - pending, pending };
}

/** Explicitly starting a new scan retries only terminally failed AI batches. */
export async function resetFailedFitBatches(userId: string): Promise<number> {
  const result = await prisma.job.updateMany({
    where: { userId, status: "NEW", fitSource: "failed" },
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
}

/**
 * A saved score is valid only for the resume snapshot used to produce it.
 * Re-queue stale rows when a profile changes, instead of continuing to sort
 * and bulk-delete jobs using evidence the candidate has already replaced.
 */
export async function invalidateStaleFitScores(userId: string): Promise<number> {
  let invalidated = 0;
  for (const scope of FIT_PROFILE_SCOPES) {
    const profile = await getResumeProfile(userId, { locale: scope.locale });
    const snapshotVersion = profile?.updatedAt.toISOString() ?? null;
    const result = await prisma.job.updateMany({
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
    invalidated += result.count;
  }
  return invalidated;
}

/**
 * Deterministic prescreen across ALL unscored NEW jobs: obvious mismatches are
 * banded POOR without an AI run. Returns how many were dequeued this way.
 */
export async function prescreenAllUnscored(userId: string): Promise<{ prescreened: number }> {
  const staleBefore = new Date(Date.now() - FIT_CLAIM_LEASE_MS);
  const jobs = await prisma.job.findMany({
    where: claimableFitWhere(userId, staleBefore),
    select: { id: true, description: true, market: true },
  });
  if (jobs.length === 0) return { prescreened: 0 };

  const resumeByLocale = new Map<
    string,
    { text: string; snapshotVersion: string } | null
  >();
  async function resumeFor(
    market: string,
  ): Promise<{ text: string; snapshotVersion: string } | null> {
    const locale = marketStringToResumeLocale(market);
    if (!resumeByLocale.has(locale)) {
      const profile = await getResumeProfile(userId, { locale });
      resumeByLocale.set(
        locale,
        profile
          ? {
              text: JSON.stringify(buildResumePromptSnapshot(profile)),
              snapshotVersion: profile.updatedAt.toISOString(),
            }
          : null,
      );
    }
    return resumeByLocale.get(locale) ?? null;
  }

  const poor: Array<{ jobId: string; score: number; snapshotVersion: string }> = [];
  for (const job of jobs) {
    const resume = await resumeFor(job.market);
    if (!resume) continue;
    const outcome = prescreenJobFit({
      jobDescription: job.description,
      resumeText: resume.text,
    });
    if (outcome.decision === "poor") {
      poor.push({
        jobId: job.id,
        score: outcome.result.score,
        snapshotVersion: resume.snapshotVersion,
      });
    }
  }

  if (poor.length > 0) {
    const now = new Date();
    const writes = await prisma.$transaction(
      poor.map((entry) =>
        prisma.job.updateMany({
          where: {
            ...claimableFitWhere(userId, staleBefore),
            id: entry.jobId,
          },
          data: {
            fitScore: entry.score,
            fitVerdict: verdictForScore(entry.score),
            fitEligibility: null,
            fitSource: "prescreen",
            fitScoredAt: now,
            fitSnapshotHash: entry.snapshotVersion,
          },
        }),
      ),
    );
    return {
      prescreened: writes.reduce((total, result) => total + result.count, 0),
    };
  }
  return { prescreened: 0 };
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
  claimToken: string | null;
};

/**
 * Atomically lease the next batch. The per-user advisory lock makes
 * select-and-claim serial across tabs and serverless instances.
 */
export async function nextFitBatch(userId: string): Promise<ClaimedFitBatch> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(
        ${FIT_CLAIM_LOCK_NAMESPACE}::integer,
        ${stableInt32(userId)}::integer
      )
    `;

    const staleBefore = new Date(Date.now() - FIT_CLAIM_LEASE_MS);
    const where = claimableFitWhere(userId, staleBefore);
    const candidateWindow = await tx.job.findMany({
      where,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: FIT_BATCH_SIZE,
      select: { id: true, market: true },
    });

    if (candidateWindow.length === 0) {
      const pendingTotal = await tx.job.count({
        where: pendingFitWhere(userId),
      });
      const leased = await tx.job.count({
        where: leasedFitWhere(userId, staleBefore),
      });
      return {
        jobIds: [],
        remaining: pendingTotal,
        pendingTotal,
        leased,
        retryAfterMs:
          pendingTotal > 0 || leased > 0 ? FIT_CLAIM_RETRY_AFTER_MS : null,
        claimToken: null,
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
    const claimToken = randomUUID();
    const claimSource = fitClaimSource(claimToken);
    const claimedRows = await tx.job.updateManyAndReturn({
      where: {
        ...where,
        id: { in: candidates.map((job) => job.id) },
      },
      data: { fitSource: claimSource, updatedAt: new Date() },
      select: { id: true },
    });
    const claimed = new Set(claimedRows.map((job) => job.id));
    const jobIds = candidates.map((job) => job.id).filter((id) => claimed.has(id));
    const pendingTotal = await tx.job.count({
      where: pendingFitWhere(userId),
    });
    const leased = await tx.job.count({
      where: leasedFitWhere(userId, staleBefore),
    });

    return {
      jobIds,
      remaining: Math.max(pendingTotal - jobIds.length, 0),
      pendingTotal,
      leased,
      retryAfterMs:
        jobIds.length === 0 && (pendingTotal > 0 || leased > 0)
          ? FIT_CLAIM_RETRY_AFTER_MS
          : null,
      claimToken: jobIds.length > 0 ? claimToken : null,
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
  const result = await prisma.job.updateMany({
    where: {
      id: { in: jobIds },
      userId,
      status: "NEW",
      fitScoredAt: null,
      fitSource: fitClaimSource(claimToken),
    },
    data: { fitSource: "failed", fitScoredAt: new Date() },
  });
  return result.count;
}

/** Release a live lease when the user cancels, so retry is immediate. */
export async function releaseFitBatchClaim(
  userId: string,
  jobIds: string[],
  claimToken: string,
): Promise<number> {
  const result = await prisma.job.updateMany({
    where: {
      id: { in: jobIds },
      userId,
      status: "NEW",
      fitScoredAt: null,
      fitSource: fitClaimSource(claimToken),
    },
    data: { fitSource: null },
  });
  return result.count;
}
