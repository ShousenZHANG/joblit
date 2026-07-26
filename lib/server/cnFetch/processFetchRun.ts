import { runCnFetch } from "./runCnFetch";
import type { CnSource } from "./types";
import {
  FETCH_RUN_COMMIT_PROTOCOL,
  commitFetchRun,
  fetchRunExecutionStopReason,
} from "@/lib/server/fetchRuns/fetchRunCommit";
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

interface ProcessResult {
  userId: string;
  runId: string;
  discovered: number;
  imported: number;
  error?: string;
  cancelled?: boolean;
  superseded?: boolean;
}

interface CnFetchRunInput {
  id: string;
  queries: unknown;
  attemptId: string;
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

async function failCnRun(
  base: Pick<ProcessResult, "userId" | "runId">,
  run: CnFetchRunInput,
  error: string,
): Promise<ProcessResult> {
  await commitFetchRun({
    protocol: FETCH_RUN_COMMIT_PROTOCOL,
    command: "fail",
    runId: run.id,
    attemptId: run.attemptId,
    error,
  });
  return { ...base, discovered: 0, imported: 0, error };
}

async function commitCnDiscovery(
  base: Pick<ProcessResult, "userId" | "runId">,
  run: CnFetchRunInput,
  discovery: CnDiscovery,
  diagnostics: CnDiagnosticSummary,
): Promise<ProcessResult> {
  const discovered = discovery.jobs.length;
  const completed = await commitFetchRun({
    protocol: FETCH_RUN_COMMIT_PROTOCOL,
    command: "commit",
    runId: run.id,
    attemptId: run.attemptId,
    batchKey: "cn-result-v1",
    batchIndex: 0,
    batchCount: 1,
    items: discovery.jobs,
    terminal: true,
    discoveredCount: discovered,
    terminalOutcome: diagnostics.failed.length > 0 ? "PARTIAL" : "SUCCEEDED",
    ...(diagnostics.detail ? { error: diagnostics.detail } : {}),
  });
  return { ...base, discovered, imported: completed.totalImported };
}

async function executeCnFetchRun(
  userId: string,
  run: CnFetchRunInput,
): Promise<ProcessResult> {
  const base = { userId, runId: run.id };
  const config = readCnRunConfig(run.queries);
  const discovery = await discoverCnRun(config);
  const diagnostics = summarizeCnDiagnostics(discovery.diagnostics);
  if (diagnostics.allFailed) {
    return failCnRun(
      base,
      run,
      `all sources failed: ${diagnostics.detail ?? "unknown error"}`,
    );
  }
  return commitCnDiscovery(base, run, discovery, diagnostics);
}

function stoppedCnRunResult(
  base: Pick<ProcessResult, "userId" | "runId">,
  stopReason: NonNullable<ReturnType<typeof fetchRunExecutionStopReason>>,
): ProcessResult {
  return {
    ...base,
    discovered: 0,
    imported: 0,
    ...(stopReason === "cancelled"
      ? { cancelled: true }
      : { superseded: true }),
  };
}

async function reportCnRunFailure(
  run: CnFetchRunInput,
  message: string,
): Promise<ReturnType<typeof fetchRunExecutionStopReason>> {
  try {
    await commitFetchRun({
      protocol: FETCH_RUN_COMMIT_PROTOCOL,
      command: "fail",
      runId: run.id,
      attemptId: run.attemptId,
      error: message,
    });
    return null;
  } catch (error) {
    return fetchRunExecutionStopReason(error);
  }
}

async function recoverCnRunFailure(
  base: Pick<ProcessResult, "userId" | "runId">,
  run: CnFetchRunInput,
  error: unknown,
): Promise<ProcessResult> {
  const stopReason = fetchRunExecutionStopReason(error);
  if (stopReason) return stoppedCnRunResult(base, stopReason);
  const message = error instanceof Error ? error.message : "unknown";
  const failureStopReason = await reportCnRunFailure(run, message);
  if (failureStopReason) return stoppedCnRunResult(base, failureStopReason);
  return { ...base, discovered: 0, imported: 0, error: message };
}

/**
 * Run a single CN FetchRun end-to-end: aggregate sources, filter
 * tombstones, insert with skipDuplicates, score fresh rows, update the
 * FetchRun status to SUCCEEDED (or FAILED on exception). Never throws —
 * errors are recorded on the FetchRun and returned on the ProcessResult.
 */
export async function processCnFetchRun(
  userId: string,
  run: CnFetchRunInput,
): Promise<ProcessResult> {
  const base = { userId, runId: run.id };
  try {
    return await executeCnFetchRun(userId, run);
  } catch (err) {
    return recoverCnRunFailure(base, run, err);
  }
}
