import { prisma } from "@/lib/server/prisma";
import { importJobsForUser } from "@/lib/server/jobs/jobImportService";
import { runSourceFetch } from "./runSourceFetch";
import { ALL_SOURCE_IDS, isKnownSourceId } from "./registry";

// Queue processor for market="GLOBAL" runs. Unlike the AU path there is no
// GitHub Actions dispatch: aggregator feeds are plain HTTP JSON, so the whole
// run completes in-process.

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

async function processOne(run: {
  id: string;
  userId: string;
  queries: unknown;
}): Promise<void> {
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
      await prisma.fetchRun.update({
        where: { id: run.id },
        data: {
          status: "FAILED",
          importedCount: 0,
          error: `all sources failed: ${detail}`,
        },
      });
      return;
    }

    let imported = 0;
    if (jobs.length > 0) {
      const result = await importJobsForUser({
        userId: run.userId,
        items: jobs.map((job) => ({ ...job, market: "GLOBAL" as const })),
      });
      imported = result.imported;
    }

    await prisma.fetchRun.update({
      where: { id: run.id },
      data: { status: "SUCCEEDED", importedCount: imported, error: null },
    });
  } catch (err) {
    await prisma.fetchRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        importedCount: 0,
        error: err instanceof Error ? err.message : "global_fetch_failed",
      },
    });
  }
}

export async function processQueuedGlobalRuns(): Promise<void> {
  const runs = await prisma.fetchRun.findMany({
    where: { market: "GLOBAL", status: "QUEUED" },
    select: { id: true, userId: true, queries: true },
    orderBy: { createdAt: "asc" },
    take: 10,
  });

  // Sequential: each run writes rows for a different user and the feeds are
  // rate-limited, so parallelising runs would multiply upstream pressure for
  // no user-visible gain.
  for (const run of runs) {
    await processOne(run);
  }
}
