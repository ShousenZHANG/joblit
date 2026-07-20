import { prisma } from "@/lib/server/prisma";
import {
  ImportJobItemSchema,
  importJobsForUser,
} from "@/lib/server/jobs/jobImportService";
import { runCnFetch } from "./runCnFetch";
import type { CnSource } from "./types";
import { acquireFetchRunLifecycleLock } from "@/lib/server/fetchRuns/fetchRunLifecycleLock";
import type { Prisma } from "@/lib/generated/prisma";

// CN fetch pipeline for one FetchRun. Called from
// /api/fetch-runs/[id]/trigger, the single-run in-process path.
//
// The fetch must run in-process where the invocation happens — fire-and-
// forget to an internal HTTP endpoint is fragile (depends on
// JOBLIT_WEB_URL, serverless cold starts, secret handoff), so we keep
// the work close to the click. A queue-sweeping cron variant existed for
// this reason and was removed once nothing scheduled it: fetches are
// user-triggered, so a sweep only ever duplicated the trigger path.

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
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const queries = Array.isArray(obj.queries)
    ? (obj.queries as unknown[]).filter((q): q is string => typeof q === "string")
    : [];
  const excludeKeywords = Array.isArray(obj.excludeKeywords)
    ? (obj.excludeKeywords as unknown[]).filter(
        (q): q is string => typeof q === "string",
      )
    : [];
  const locations = Array.isArray(obj.locations)
    ? (obj.locations as unknown[]).filter((q): q is string => typeof q === "string")
    : [];
  const rawSources = Array.isArray(obj.sources) ? (obj.sources as unknown[]) : [];
  const sources = rawSources.filter((s): s is CnSource => s === "nowcoder");
  return {
    queries,
    sources: sources.length > 0 ? sources : ["nowcoder"],
    excludeKeywords,
    locations,
  };
}

interface ProcessResult {
  userId: string;
  runId: string;
  discovered: number;
  imported: number;
  error?: string;
  cancelled?: boolean;
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

    const result = await runCnFetch({
      sources: config.sources,
      queries: config.queries,
      excludeKeywords: config.excludeKeywords,
      locations: config.locations,
    });

    const failedSources = result.diagnostics.filter(
      (diagnostic) => !diagnostic.ok,
    );
    if (
      result.diagnostics.length > 0 &&
      failedSources.length === result.diagnostics.length
    ) {
      const message = `all sources failed: ${failedSources
        .map(
          (diagnostic) =>
            `${diagnostic.source}: ${diagnostic.error ?? "unknown error"}`,
        )
        .join("; ")}`;
      const failedRun = await updateActiveRun(run.id, async (tx) => {
        await tx.fetchRun.updateMany({
          where: { id: run.id, userId, status: "RUNNING" },
          data: { status: "FAILED", importedCount: 0, error: message },
        });
        return { ...base, discovered: 0, imported: 0, error: message };
      });
      return failedRun ?? {
        ...base,
        discovered: 0,
        imported: 0,
        cancelled: true,
      };
    }

    const discovered = result.jobs.length;
    const completed = await updateActiveRun(run.id, async (tx) => {
      let imported = 0;
      if (discovered > 0) {
        const importResult = await importJobsForUser({
          userId,
          items: result.jobs.map((job) => ImportJobItemSchema.parse(job)),
        });
        imported = importResult.imported;
      }
      await tx.fetchRun.updateMany({
        where: { id: run.id, userId, status: "RUNNING" },
        data: { status: "SUCCEEDED", importedCount: imported, error: null },
      });
      return { ...base, discovered, imported };
    });
    return completed ?? { ...base, discovered: 0, imported: 0, cancelled: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    const failedRun = await updateActiveRun(run.id, async (tx) => {
      await tx.fetchRun.updateMany({
        where: { id: run.id, userId, status: "RUNNING" },
        data: { status: "FAILED", importedCount: 0, error: message },
      });
      return { ...base, discovered: 0, imported: 0, error: message };
    }).catch(() => null);
    return failedRun ?? {
      ...base,
      discovered: 0,
      imported: 0,
      cancelled: true,
    };
  }
}
