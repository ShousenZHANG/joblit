import { prisma } from "@/lib/server/prisma";
import { importJobsForUser } from "@/lib/server/jobs/jobImportService";
import { runSourceFetch } from "./runSourceFetch";
import {
  ALL_SOURCE_IDS,
  ATS_BOARD_REGISTRY_ISSUES,
  SOURCE_ADAPTERS,
  isKnownSourceId,
} from "./registry";
import { loadEnabledAtsBoardAdapters } from "./atsBoardStore";
import { recoverAtsBoardsAfter404 } from "./atsRediscoveryService";
import { persistSourceHealthDiagnostics } from "./sourceHealthStore";
import { MAX_GLOBAL_SOURCES_PER_RUN } from "./limits";
import { reconcileFetchedSourceJobLiveness } from "@/lib/server/jobs/sourceLivenessService";
import { filterSourceJobs, type SourceJobFilter } from "./filterSourceJobs";
import { acquireFetchRunLifecycleLock } from "@/lib/server/fetchRuns/fetchRunLifecycleLock";
import { reportError } from "@/lib/server/observability/errorReporter";
import type { Prisma } from "@/lib/generated/prisma";
import type { SourceAdapter } from "./types";
import type { AtsBoardConfig } from "./atsBoards";

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

function requestedSources(
  queries: unknown,
  dynamicSourceIds: readonly string[],
): string[] {
  const dynamic = new Set(dynamicSourceIds);
  const record =
    queries && typeof queries === "object" && !Array.isArray(queries)
      ? (queries as Record<string, unknown>)
      : null;
  const raw =
    record?.sources;
  if (!Array.isArray(raw)) return [...ALL_SOURCE_IDS, ...dynamicSourceIds];
  const cleaned = raw
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.trim())
    .filter((s) => isKnownSourceId(s) || dynamic.has(s));
  // Legacy runs expanded an omitted list to the static registry without
  // recording intent. Preserve "all" for those rows. New explicit selections
  // carry sourceSelection="explicit" and must not silently re-enable boards.
  const selected = cleaned.length ? cleaned : [...ALL_SOURCE_IDS];
  return [
    ...new Set([
      ...selected,
      ...(record?.sourceSelection === "explicit" ? [] : dynamicSourceIds),
    ]),
  ];
}

async function runtimeAtsBoards(userId: string): Promise<{
  adapters: SourceAdapter[];
  boards: AtsBoardConfig[];
}> {
  if (ATS_BOARD_REGISTRY_ISSUES.length) {
    reportError(new Error("Invalid ATS board environment configuration"), {
      scope: "sources.ats.environment_config",
      severity: "warning",
      userId,
      extra: { issues: ATS_BOARD_REGISTRY_ISSUES },
    });
  }
  try {
    const loaded = await loadEnabledAtsBoardAdapters();
    if (loaded.issues.length) {
      reportError(new Error("Invalid ATS board database configuration"), {
        scope: "sources.ats.database_config",
        severity: "warning",
        userId,
        extra: { issues: loaded.issues },
      });
    }
    return { adapters: loaded.adapters, boards: loaded.boards };
  } catch (error) {
    // ATS registry is additive. A migration race or transient registry read
    // must not take the three core public feeds offline.
    reportError(error, {
      scope: "sources.ats.load",
      severity: "warning",
      userId,
    });
    return { adapters: [], boards: [] };
  }
}

function mergeRecoveredJobs(
  jobs: readonly Parameters<typeof filterSourceJobs>[0][number][],
  recovered: readonly {
    source: string;
    jobs: Parameters<typeof filterSourceJobs>[0][number][];
  }[],
): Parameters<typeof filterSourceJobs>[0][number][] {
  const seen = new Set(jobs.map((job) => job.jobUrl));
  const merged = [...jobs];
  for (const source of recovered) {
    for (const job of source.jobs) {
      if (seen.has(job.jobUrl)) continue;
      seen.add(job.jobUrl);
      merged.push(job);
    }
  }
  return merged;
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
    const {
      adapters: dynamicAdapters,
      boards: dynamicBoards,
    } = await runtimeAtsBoards(userId);
    const dynamicIds: string[] = [];
    const adapterMap = new Map(
      SOURCE_ADAPTERS.map((adapter) => [adapter.id, adapter]),
    );
    for (const adapter of dynamicAdapters) {
      if (adapterMap.has(adapter.id) && !adapter.id.startsWith("ats:")) {
        continue;
      }
      adapterMap.set(adapter.id, adapter);
      dynamicIds.push(adapter.id);
    }
    const sources = requestedSources(run.queries, dynamicIds);
    if (sources.length > MAX_GLOBAL_SOURCES_PER_RUN) {
      throw new Error(
        `source limit exceeded: ${sources.length} configured, maximum ${MAX_GLOBAL_SOURCES_PER_RUN} per run`,
      );
    }
    const fetched = await runSourceFetch({
      sources,
      ...(dynamicIds.length ? { adapters: [...adapterMap.values()] } : {}),
    });
    const recovery = await recoverAtsBoardsAfter404({
      boards: dynamicBoards,
      diagnostics: fetched.diagnostics,
    });
    if (recovery.errors.length) {
      reportError(new Error("ATS board rediscovery failed"), {
        scope: "sources.ats.rediscovery",
        severity: "warning",
        userId,
        extra: { errors: recovery.errors },
      });
    }
    const recoveredBySource = new Map(
      recovery.recovered.map((item) => [item.source, item]),
    );
    const jobs = mergeRecoveredJobs(fetched.jobs, recovery.recovered);
    const diagnostics = fetched.diagnostics.map((diagnostic) => {
      const recovered = recoveredBySource.get(diagnostic.source);
      return recovered
        ? {
            source: diagnostic.source,
            ok: true,
            raw: recovered.jobs.length,
          }
        : diagnostic;
    });
    await persistSourceHealthDiagnostics(diagnostics).catch((error) => {
      reportError(error, {
        scope: "sources.health.persist",
        severity: "warning",
        userId,
      });
    });
    await reconcileFetchedSourceJobLiveness({
      userId,
      diagnostics,
      jobs,
    }).catch((error) => {
      reportError(error, {
        scope: "jobs.liveness.reconcile_source_feed",
        severity: "warning",
        userId,
      });
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
