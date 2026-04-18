import { prisma } from "@/lib/server/prisma";
import { canonicalizeJobUrl } from "@/lib/shared/canonicalizeJobUrl";
import { scoreSingleJob } from "@/lib/server/jobs/scoreJobs";
import { runCnFetch } from "./runCnFetch";
import type { CnSource } from "./types";

// Shared CN fetch pipeline per FetchRun. Called from:
//   - /api/cron/fetch-cn  (sweeps all QUEUED CN runs)
//   - /api/fetch-runs/[id]/trigger  (single-run in-process path)
// The fetch must run in-process where the invocation happens — fire-and-
// forget to an internal HTTP endpoint is fragile (depends on
// JOBLIT_WEB_URL, serverless cold starts, secret handoff), so we keep
// the work close to the click.

interface CnRunConfig {
  queries: string[];
  sources: CnSource[];
  excludeKeywords: string[];
}

/**
 * Parse the FetchRun.queries JSON into the shape the aggregator expects.
 * Defaults to V2EX + GitHub when sources is missing or malformed so a
 * stale run from before the CN aggregator migration still works.
 */
export function readCnRunConfig(raw: unknown): CnRunConfig {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const queries = Array.isArray(obj.queries)
    ? (obj.queries as unknown[]).filter((q): q is string => typeof q === "string")
    : [];
  const excludeKeywords = Array.isArray(obj.excludeKeywords)
    ? (obj.excludeKeywords as unknown[]).filter(
        (q): q is string => typeof q === "string",
      )
    : [];
  const rawSources = Array.isArray(obj.sources) ? (obj.sources as unknown[]) : [];
  const sources = rawSources.filter(
    (s): s is CnSource => s === "v2ex" || s === "github" || s === "rsshub",
  );
  return {
    queries,
    sources: sources.length > 0 ? sources : ["v2ex", "github"],
    excludeKeywords,
  };
}

export interface ProcessResult {
  userId: string;
  runId: string;
  discovered: number;
  imported: number;
  scored: number;
  error?: string;
}

/**
 * Run a single CN FetchRun end-to-end: aggregate sources, filter
 * tombstones, insert with skipDuplicates, score fresh rows, update the
 * FetchRun status to SUCCEEDED (or FAILED on exception). Never throws —
 * errors are recorded on the FetchRun and returned on the ProcessResult.
 */
export async function processCnFetchRun(
  userId: string,
  run: { id: string; queries: unknown },
): Promise<ProcessResult> {
  const base = { userId, runId: run.id };
  try {
    const config = readCnRunConfig(run.queries);

    await prisma.fetchRun.update({
      where: { id: run.id },
      data: { status: "RUNNING", error: null },
    });

    const result = await runCnFetch({
      sources: config.sources,
      queries: config.queries,
      excludeKeywords: config.excludeKeywords,
    });

    const discovered = result.jobs.length;
    if (discovered === 0) {
      await prisma.fetchRun.update({
        where: { id: run.id },
        data: { status: "SUCCEEDED", importedCount: 0 },
      });
      return { ...base, discovered: 0, imported: 0, scored: 0 };
    }

    // Tombstone filter — skip URLs the user previously deleted.
    const deleted = await prisma.deletedJobUrl.findMany({
      where: { userId },
      select: { jobUrl: true },
    });
    const deletedSet = new Set(
      deleted.map((d) => canonicalizeJobUrl(d.jobUrl)),
    );
    const filtered = result.jobs.filter((j) => !deletedSet.has(j.jobUrl));

    const BATCH = 200;
    let imported = 0;
    for (let i = 0; i < filtered.length; i += BATCH) {
      const batch = filtered.slice(i, i + BATCH);
      const res = await prisma.job.createMany({
        data: batch.map((j) => ({
          userId,
          jobUrl: j.jobUrl,
          title: j.title,
          company: j.company,
          location: j.location,
          jobType: j.jobType,
          jobLevel: j.jobLevel,
          description: j.description,
          market: "CN",
          status: "NEW",
        })),
        skipDuplicates: true,
      });
      imported += res.count;
    }

    // Score fresh (matchScore null) rows against active resume profile.
    let scored = 0;
    if (imported > 0) {
      const fresh = await prisma.job.findMany({
        where: {
          userId,
          market: "CN",
          matchScore: null,
          jobUrl: { in: filtered.map((j) => j.jobUrl) },
        },
        select: { id: true },
        take: imported,
      });
      for (const row of fresh) {
        try {
          await scoreSingleJob(userId, row.id);
          scored++;
        } catch {
          // Non-fatal — job row remains usable without a score.
        }
      }
    }

    await prisma.fetchRun.update({
      where: { id: run.id },
      data: { status: "SUCCEEDED", importedCount: imported },
    });
    return { ...base, discovered, imported, scored };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    await prisma.fetchRun
      .update({
        where: { id: run.id },
        data: { status: "FAILED", error: message },
      })
      .catch(() => {});
    return { ...base, discovered: 0, imported: 0, scored: 0, error: message };
  }
}

/**
 * Sweep every user's most-recent QUEUED CN FetchRun. Used by the cron
 * endpoint (manual curl / future scheduled triggers). Per-user failures
 * do not abort the sweep.
 */
export async function processAllQueuedCnRuns(
  options: { limit?: number } = {},
): Promise<{
  startedAt: string;
  processed: number;
  users: ProcessResult[];
}> {
  const limit = options.limit ?? 50;
  const queued = await prisma.fetchRun.findMany({
    where: { market: "CN", status: "QUEUED" },
    orderBy: { createdAt: "desc" },
    select: { id: true, userId: true, queries: true },
    take: limit * 4,
  });

  const latestByUser = new Map<
    string,
    { id: string; queries: unknown }
  >();
  for (const r of queued) {
    if (!latestByUser.has(r.userId)) {
      latestByUser.set(r.userId, { id: r.id, queries: r.queries });
    }
  }

  const users: ProcessResult[] = [];
  for (const [userId, run] of latestByUser) {
    if (users.length >= limit) break;
    users.push(await processCnFetchRun(userId, run));
  }

  return {
    startedAt: new Date().toISOString(),
    processed: users.length,
    users,
  };
}
