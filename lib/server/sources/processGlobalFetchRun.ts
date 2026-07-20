import { prisma } from "@/lib/server/prisma";
import { importJobsForUser } from "@/lib/server/jobs/jobImportService";
import { runSourceFetch } from "./runSourceFetch";
import { ALL_SOURCE_IDS, isKnownSourceId } from "./registry";

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
      await prisma.fetchRun.update({
        where: { id: run.id },
        data: { status: "FAILED", importedCount: 0, error },
      });
      return { discovered: 0, imported: 0, error };
    }

    let imported = 0;
    if (jobs.length > 0) {
      const result = await importJobsForUser({
        userId,
        items: jobs.map((job) => ({ ...job, market: "GLOBAL" as const })),
      });
      imported = result.imported;
    }

    await prisma.fetchRun.update({
      where: { id: run.id },
      data: { status: "SUCCEEDED", importedCount: imported, error: null },
    });
    return { discovered: jobs.length, imported };
  } catch (err) {
    const error = err instanceof Error ? err.message : "global_fetch_failed";
    await prisma.fetchRun.update({
      where: { id: run.id },
      data: { status: "FAILED", importedCount: 0, error },
    });
    return { discovered: 0, imported: 0, error };
  }
}

