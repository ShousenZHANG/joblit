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
import { resolveTitleMatchMode } from "@/lib/shared/jobRelevance";
import { filterSourceJobs, type SourceJobFilter } from "./filterSourceJobs";
import { reportError } from "@/lib/server/observability/errorReporter";
import type { RawSourceJob, SourceAdapter } from "./types";
import type { AtsBoardConfig } from "./atsBoards";
import type {
  InlineFetchRunAdapter,
  InlineFetchRunTerminalPlan,
} from "@/lib/server/fetchRuns/inlineFetchRunAdapter";
import {
  normalizeFetchRunConfigV1,
  type GlobalFetchRunConfigV1,
} from "@/lib/shared/schemas/fetchRunConfig";

// Runner for one market="GLOBAL" FetchRun, called from
// /api/fetch-runs/[id]/trigger.
//
// Unlike the AU path there is no GitHub Actions dispatch: aggregator feeds are
// plain HTTP JSON, so the whole run completes in-process, the same way the CN
// adapters already do. Fetches are user-triggered, so there is deliberately no
// queue-sweeping variant — a sweep would only duplicate the trigger path.

interface RuntimeSourceRegistry {
  adapters?: SourceAdapter[];
  boards: AtsBoardConfig[];
  dynamicIds: string[];
}

type GlobalDiscovery = Awaited<ReturnType<typeof runSourceFetch>>;
type GlobalDiagnostic = GlobalDiscovery["diagnostics"][number];

interface GlobalDiscoverySnapshot {
  jobs: RawSourceJob[];
  diagnostics: GlobalDiagnostic[];
  observedAt: Date;
}

interface GlobalDiagnosticSummary {
  failed: GlobalDiagnostic[];
  allFailed: boolean;
  detail?: string;
}

function requestedSources(
  config: GlobalFetchRunConfigV1,
  dynamicSourceIds: readonly string[],
  hasPersistedSourceSnapshot: boolean,
): string[] {
  const dynamic = new Set(dynamicSourceIds);
  const requested = config.sources
    .map((s) => s.trim())
    .filter(Boolean);
  if (
    config.sourceSelection === "explicit" ||
    (hasPersistedSourceSnapshot && requested.length > 0)
  ) {
    // The persisted selection is execution intent. Keep unavailable dynamic
    // IDs in the request so runSourceFetch emits an `unknown_source`
    // diagnostic. A v1 "all" run is also a creation-time snapshot: sources
    // enabled later must not join it, and a source disabled later must remain
    // visible as unavailable instead of disappearing silently.
    return [...new Set(requested)];
  }
  const cleaned = requested.filter(
    (source) => isKnownSourceId(source) || dynamic.has(source),
  );
  // Legacy runs expanded an omitted list to the static registry without
  // recording intent. Preserve "all" only for those rows.
  const selected = cleaned.length ? cleaned : [...ALL_SOURCE_IDS];
  return [...new Set([...selected, ...dynamicSourceIds])];
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

function readGlobalRunConfig(raw: unknown): GlobalFetchRunConfigV1 {
  const config = normalizeFetchRunConfigV1({
    market: "GLOBAL",
    queries: raw,
  });
  if (config.market !== "GLOBAL") {
    throw new Error("FetchRun config market must be GLOBAL");
  }
  return config;
}

async function buildRuntimeSourceRegistry(
  userId: string,
): Promise<RuntimeSourceRegistry> {
  const { adapters: dynamicAdapters, boards } = await runtimeAtsBoards(userId);
  const dynamicIds: string[] = [];
  const adapterMap = new Map(
    SOURCE_ADAPTERS.map((adapter) => [adapter.id, adapter]),
  );
  for (const adapter of dynamicAdapters) {
    if (adapterMap.has(adapter.id) && !adapter.id.startsWith("ats:")) continue;
    adapterMap.set(adapter.id, adapter);
    dynamicIds.push(adapter.id);
  }
  return {
    boards,
    dynamicIds,
    ...(dynamicIds.length ? { adapters: [...adapterMap.values()] } : {}),
  };
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

async function recoverGlobalDiscovery(
  userId: string,
  boards: AtsBoardConfig[],
  fetched: GlobalDiscovery,
): Promise<Pick<GlobalDiscoverySnapshot, "jobs" | "diagnostics">> {
  // Registry repair owns an exact-value CAS plus a global cooldown and is
  // intentionally independent from the user-scoped run projection.
  const recovery = await recoverAtsBoardsAfter404({
    boards,
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
  return {
    jobs: mergeRecoveredJobs(fetched.jobs, recovery.recovered),
    diagnostics: fetched.diagnostics.map((diagnostic) => {
      const recovered = recoveredBySource.get(diagnostic.source);
      return recovered
        ? { source: diagnostic.source, ok: true, raw: recovered.jobs.length }
        : diagnostic;
    }),
  };
}

async function discoverGlobalSources(
  userId: string,
  config: GlobalFetchRunConfigV1,
  runtime: RuntimeSourceRegistry,
  hasPersistedSourceSnapshot: boolean,
): Promise<GlobalDiscoverySnapshot> {
  const sources = requestedSources(
    config,
    runtime.dynamicIds,
    hasPersistedSourceSnapshot,
  );
  if (sources.length > MAX_GLOBAL_SOURCES_PER_RUN) {
    throw new Error(
      `source limit exceeded: ${sources.length} configured, maximum ${MAX_GLOBAL_SOURCES_PER_RUN} per run`,
    );
  }
  const fetched = await runSourceFetch({
    sources,
    ...(runtime.adapters ? { adapters: runtime.adapters } : {}),
  });
  const recovered = await recoverGlobalDiscovery(
    userId,
    runtime.boards,
    fetched,
  );
  return { ...recovered, observedAt: new Date() };
}

function summarizeGlobalDiagnostics(
  diagnostics: GlobalDiagnostic[],
): GlobalDiagnosticSummary {
  const failed = diagnostics.filter((diagnostic) => !diagnostic.ok);
  const detail =
    failed.length > 0
      ? failed
          .map(
            (diagnostic) =>
              `${diagnostic.source}: ${diagnostic.error ?? "unknown error"}`,
          )
          .join("; ")
      : undefined;
  return {
    failed,
    allFailed: diagnostics.length > 0 && failed.length === diagnostics.length,
    ...(detail ? { detail } : {}),
  };
}

async function persistCanonicalSourceObservations({
  userId,
  diagnostics,
  jobs,
  observedAt,
}: {
  userId: string;
  diagnostics: Parameters<typeof persistSourceHealthDiagnostics>[0];
  jobs: Parameters<typeof reconcileFetchedSourceJobLiveness>[0]["jobs"];
  observedAt: Date;
}): Promise<void> {
  await persistSourceHealthDiagnostics(diagnostics, observedAt).catch(
    (error) => {
      reportError(error, {
        scope: "sources.health.persist",
        severity: "warning",
        userId,
      });
    },
  );
  await reconcileFetchedSourceJobLiveness({
    userId,
    diagnostics,
    jobs,
    checkedAt: observedAt,
  }).catch((error) => {
    reportError(error, {
      scope: "jobs.liveness.reconcile_source_feed",
      severity: "warning",
      userId,
    });
  });
}

function globalProjectionHook(
  userId: string,
  snapshot: GlobalDiscoverySnapshot,
): () => Promise<void> {
  return () =>
    persistCanonicalSourceObservations({
      userId,
      diagnostics: snapshot.diagnostics,
      jobs: snapshot.jobs,
      observedAt: snapshot.observedAt,
    });
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
  const positiveInteger = (candidate: unknown) =>
    typeof candidate === "number" &&
    Number.isInteger(candidate) &&
    candidate > 0
      ? candidate
      : null;
  const hoursOld = positiveInteger(value.hoursOld);
  return {
    queries: strings(value.queries),
    baseQueries: strings(value.baseQueries),
    queryMode: value.queryMode === "source-only" ? "source-only" : "query",
    location: typeof value.location === "string" ? value.location : null,
    hoursOld,
    excludeTitleTerms: applyExcludes ? strings(value.excludeTitleTerms) : [],
    excludeDescriptionRules: applyExcludes
      ? strings(value.excludeDescriptionRules)
      : [],
    titleMatch: resolveTitleMatchMode(value),
    // Public feeds have no server-side search, so an "off" run would import a
    // source's whole catalogue without this. resultsWanted was already in the
    // config; this path simply never read it.
    resultsWanted: positiveInteger(value.resultsWanted),
  };
}

function planFailedGlobalDiscovery(
  userId: string,
  snapshot: GlobalDiscoverySnapshot,
  detail: string,
): InlineFetchRunTerminalPlan {
  return {
    kind: "fail",
    error: `all sources failed: ${detail}`,
    postTerminal: globalProjectionHook(userId, snapshot),
  };
}

function planGlobalDiscovery(
  userId: string,
  config: GlobalFetchRunConfigV1,
  snapshot: GlobalDiscoverySnapshot,
  summary: GlobalDiagnosticSummary,
): InlineFetchRunTerminalPlan {
  const jobs = filterSourceJobs(snapshot.jobs, readFilter(config));
  return {
    kind: "commit",
    batchKey: "global-result-v1",
    items: jobs.map((job) => ({ ...job, market: "GLOBAL" as const })),
    discovered: jobs.length,
    terminalOutcome: summary.failed.length > 0 ? "PARTIAL" : "SUCCEEDED",
    ...(summary.detail ? { error: summary.detail } : {}),
    postTerminal: globalProjectionHook(userId, snapshot),
  };
}

export const discoverGlobalFetchRun: InlineFetchRunAdapter = async ({
  userId,
  queries,
}) => {
  const config = readGlobalRunConfig(queries);
  const rawConfig =
    queries && typeof queries === "object" && !Array.isArray(queries)
      ? (queries as Record<string, unknown>)
      : null;
  const hasPersistedSourceSnapshot =
    rawConfig?.schemaVersion === 1 && config.sources.length > 0;
  const runtime = await buildRuntimeSourceRegistry(userId);
  const snapshot = await discoverGlobalSources(
    userId,
    config,
    runtime,
    hasPersistedSourceSnapshot,
  );
  const summary = summarizeGlobalDiagnostics(snapshot.diagnostics);
  // Reporting success with zero rows when every attempted source failed would
  // turn an outage into an ordinary empty result.
  if (summary.allFailed) {
    return planFailedGlobalDiscovery(
      userId,
      snapshot,
      summary.detail ?? "unknown error",
    );
  }
  return planGlobalDiscovery(userId, config, snapshot, summary);
};
