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

/**
 * Deterministic prescreen across ALL unscored NEW jobs: obvious mismatches are
 * banded POOR without an AI run. Returns how many were dequeued this way.
 */
export async function prescreenAllUnscored(userId: string): Promise<{ prescreened: number }> {
  const jobs = await prisma.job.findMany({
    where: { userId, status: "NEW", fitScoredAt: null },
    select: { id: true, description: true, market: true },
  });
  if (jobs.length === 0) return { prescreened: 0 };

  const resumeTextByLocale = new Map<string, string | null>();
  async function resumeTextFor(market: string): Promise<string | null> {
    const locale = marketStringToResumeLocale(market);
    if (!resumeTextByLocale.has(locale)) {
      const profile = await getResumeProfile(userId, { locale });
      resumeTextByLocale.set(
        locale,
        profile ? JSON.stringify(buildResumePromptSnapshot(profile)) : null,
      );
    }
    return resumeTextByLocale.get(locale) ?? null;
  }

  const poor: Array<{ jobId: string; score: number }> = [];
  for (const job of jobs) {
    const resumeText = await resumeTextFor(job.market);
    if (!resumeText) continue;
    const outcome = prescreenJobFit({ jobDescription: job.description, resumeText });
    if (outcome.decision === "poor") {
      poor.push({ jobId: job.id, score: outcome.result.score });
    }
  }

  if (poor.length > 0) {
    const now = new Date();
    await prisma.$transaction(
      poor.map((entry) =>
        prisma.job.updateMany({
          where: { id: entry.jobId, userId },
          data: {
            fitScore: entry.score,
            fitVerdict: verdictForScore(entry.score),
            fitEligibility: null,
            fitSource: "prescreen",
            fitScoredAt: now,
            fitSnapshotHash: null,
          },
        }),
      ),
    );
  }
  return { prescreened: poor.length };
}

/** Next batch of unscored NEW jobs (oldest first) plus how many remain after it. */
export async function nextFitBatch(userId: string): Promise<{ jobIds: string[]; remaining: number }> {
  const where = { userId, status: "NEW" as const, fitScoredAt: null };
  const [batch, pending] = await Promise.all([
    prisma.job.findMany({
      where,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: FIT_BATCH_SIZE,
      select: { id: true },
    }),
    prisma.job.count({ where }),
  ]);
  return { jobIds: batch.map((job) => job.id), remaining: Math.max(pending - batch.length, 0) };
}

/**
 * Dequeue jobs whose AI batch failed terminally so the pump cannot loop on
 * them forever. They keep a null score (rendered as unscored) but carry a
 * "failed" source and a timestamp; a future rescan can clear and retry them.
 */
export async function markFitBatchFailed(userId: string, jobIds: string[]): Promise<number> {
  const result = await prisma.job.updateMany({
    where: { id: { in: jobIds }, userId, status: "NEW", fitScoredAt: null },
    data: { fitSource: "failed", fitScoredAt: new Date() },
  });
  return result.count;
}
