import { runCnFetch } from "./runCnFetch";
import type { CnSource } from "./types";
import type {
  InlineFetchRunAdapter,
  InlineFetchRunTerminalPlan,
} from "@/lib/server/fetchRuns/inlineFetchRunAdapter";
import { normalizeFetchRunConfigV1 } from "@/lib/shared/schemas/fetchRunConfig";

// CN fetch pipeline for one FetchRun. Called from
// /api/fetch-runs/[id]/trigger, the single-run in-process path.
//
// The fetch must run in-process where the invocation happens — fire-and-
// forget to an internal HTTP endpoint is fragile (depends on
// JOBLIT_WEB_URL, serverless cold starts, secret handoff), so we keep
// the work close to the click. Background queue sweeping was removed because
// fetches are user-triggered and a sweep only duplicated the trigger path.

interface CnRunConfig {
  queries: string[];
  sources: CnSource[];
  excludeKeywords: string[];
  locations: string[];
}

/**
 * Parse the FetchRun.queries JSON into the shape the aggregator expects.
 * Defaults to Nowcoder when sources is missing or malformed (the only CN
 * source) so stale runs from before the single-source migration still work.
 */
function readCnRunConfig(raw: unknown): CnRunConfig {
  const config = normalizeFetchRunConfigV1({ market: "CN", queries: raw });
  if (config.market !== "CN") {
    throw new Error("FetchRun config market must be CN");
  }
  return {
    queries: config.queries,
    sources: config.sources as CnSource[],
    excludeKeywords: config.excludeKeywords,
    locations: config.locations,
  };
}

type CnDiscovery = Awaited<ReturnType<typeof runCnFetch>>;
type CnDiagnostic = CnDiscovery["diagnostics"][number];

interface CnDiagnosticSummary {
  failed: CnDiagnostic[];
  allFailed: boolean;
  detail?: string;
}

async function discoverCnRun(config: CnRunConfig): Promise<CnDiscovery> {
  return runCnFetch({
    sources: config.sources,
    queries: config.queries,
    excludeKeywords: config.excludeKeywords,
    locations: config.locations,
  });
}

function summarizeCnDiagnostics(
  diagnostics: CnDiscovery["diagnostics"],
): CnDiagnosticSummary {
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

function planCnDiscovery(
  discovery: CnDiscovery,
  diagnostics: CnDiagnosticSummary,
): InlineFetchRunTerminalPlan {
  const discovered = discovery.jobs.length;
  return {
    kind: "commit",
    batchKey: "cn-result-v1",
    items: discovery.jobs,
    discovered,
    terminalOutcome: diagnostics.failed.length > 0 ? "PARTIAL" : "SUCCEEDED",
    ...(diagnostics.detail ? { error: diagnostics.detail } : {}),
  };
}

export const discoverCnFetchRun: InlineFetchRunAdapter = async ({
  queries,
}) => {
  const config = readCnRunConfig(queries);
  const discovery = await discoverCnRun(config);
  const diagnostics = summarizeCnDiagnostics(discovery.diagnostics);
  if (diagnostics.allFailed) {
    return {
      kind: "fail",
      error: `all sources failed: ${diagnostics.detail ?? "unknown error"}`,
    };
  }
  return planCnDiscovery(discovery, diagnostics);
};
