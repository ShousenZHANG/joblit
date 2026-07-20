import { prisma } from "@/lib/server/prisma";
import { importJobsForUser } from "@/lib/server/jobs/jobImportService";
import { runSourceFetch } from "./runSourceFetch";
import { ALL_SOURCE_IDS, isKnownSourceId } from "./registry";
import { filterSourceJobs, type SourceJobFilter } from "./filterSourceJobs";
import { acquireFetchRunLifecycleLock } from "@/lib/server/fetchRuns/fetchRunLifecycleLock";
import type { Prisma } from "@/lib/generated/prisma";

// Runner for one market="GLOBAL" FetchRun, called from
// /api/fetch-runs/[id]/trigger.
//
// Unlike the AU path there is no GitHub Actions dispatch: aggregator feeds are
// plain HTTP JSON, so the whole run completes in-process, the same way the CN
// adapters already do. Fetches are user-triggered, so there is deliberately no
// queue-sweeping variant — a sweep would only duplicate the trigger path.

export interface GlobalFetchRunResult {
  discovered: number;
  imported: number;
  error?: string;
  cancelled?: boolean;
}

function requestedSources(queries: unknown): string[] {
  const raw =
    queries && typeof queries === "object"
      ? (queries as Record<string, unknown>).sources
      : null;
  if (!Array.isArray(raw)) return [...ALL_SOURCE_IDS];
  const cleaned = raw
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.trim())
    .filter((s) => isKnownSourceId(s));
  return cleaned.length ? cleaned : [...ALL_SOURCE_IDS];
}

function readFilter(queries: unknown): SourceJobFilter {
  const value =
    queries && typeof queries === "object" && !Array.isArray(queries)
      ? (queries as Record<string, unknown>)
      : {};
  const strings = (candidate: unknown) =>
    Array.isArray(candidate)
      ? candidate.filter((item): item is string => typeof item === "string")
      : [];
  const applyExcludes = value.applyExcludes !== false;
  const hoursOld =
    typeof value.hoursOld === "number" &&
    Number.isInteger(value.hoursOld) &&
    value.hoursOld > 0
      ? value.hoursOld
      : null;
  return {
    queries: strings(value.queries),
    baseQueries: strings(value.baseQueries),
    location: typeof value.location === "string" ? value.location : null,
    hoursOld,
    excludeTitleTerms: applyExcludes ? strings(value.excludeTitleTerms) : [],
    excludeDescriptionRules: applyExcludes
      ? strings(value.excludeDescriptionRules)
      : [],
    strictTitles: value.includeFromQueries !== false,
  };
}

async function updateActiveRun<T>(
  runId: string,
  action: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T | null> {
  return prisma.$transaction(
    async (tx) => {
      await acquireFetchRunLifecycleLock(tx, runId);
      const active = await tx.fetchRun.findFirst({
        where: { id: runId, status: "RUNNING" },
        select: { id: true },
      });
      if (!active) return null;
      return action(tx);
    },
    { timeout: 30_000 },
  );
}

/** Execute one queued GLOBAL run and write its terminal status. */
export async function processGlobalFetchRun(
  userId: string,
  run: { id: string; queries: unknown },
): Promise<GlobalFetchRunResult> {
  try {
    const { jobs, diagnostics } = await runSourceFetch({
      sources: requestedSources(run.queries),
    });

    // Every source failing is a run failure — reporting SUCCEEDED with zero
    // rows would hide an outage behind an ordinary empty result.
    const attempted = diagnostics.length;
    const failed = diagnostics.filter((d) => !d.ok);
    if (attempted > 0 && failed.length === attempted) {
      const detail = failed
        .map((d) => `${d.source}: ${d.error ?? "unknown error"}`)
        .join("; ");
      const error = `all sources failed: ${detail}`;
      const failedRun = await updateActiveRun(run.id, async (tx) => {
        await tx.fetchRun.updateMany({
          where: { id: run.id, userId, status: "RUNNING" },
          data: { status: "FAILED", importedCount: 0, error },
        });
        return { discovered: 0, imported: 0, error };
      });
      return failedRun ?? { discovered: 0, imported: 0, cancelled: true };
    }

    const filteredJobs = filterSourceJobs(jobs, readFilter(run.queries));
    const completed = await updateActiveRun(run.id, async (tx) => {
      let imported = 0;
      if (filteredJobs.length > 0) {
        const result = await importJobsForUser({
          userId,
          items: filteredJobs.map((job) => ({ ...job, market: "GLOBAL" as const })),
        });
        imported = result.imported;
      }

      await tx.fetchRun.updateMany({
        where: { id: run.id, userId, status: "RUNNING" },
        data: { status: "SUCCEEDED", importedCount: imported, error: null },
      });
      return { discovered: filteredJobs.length, imported };
    });
    return completed ?? { discovered: 0, imported: 0, cancelled: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : "global_fetch_failed";
    const failedRun = await updateActiveRun(run.id, async (tx) => {
      await tx.fetchRun.updateMany({
        where: { id: run.id, userId, status: "RUNNING" },
        data: { status: "FAILED", importedCount: 0, error },
      });
      return { discovered: 0, imported: 0, error };
    }).catch(() => null);
    return failedRun ?? { discovered: 0, imported: 0, cancelled: true };
  }
}
