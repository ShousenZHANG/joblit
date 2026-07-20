import type { RawSourceJob, SourceAdapter, SourceAdapterResult } from "./types";
import { SOURCE_REGISTRY } from "./registry";
import { makeSourceContext } from "./http";

// Multi-source orchestrator, shaped after runCnFetch: every adapter runs in
// parallel so one slow feed cannot stall the run, and a per-source failure is
// recorded as a diagnostic instead of aborting — the user still gets whatever
// the healthy sources returned.

interface RunSourceFetchOptions {
  sources: string[];
  /** Test seam: adapters to use instead of the production registry. */
  adapters?: SourceAdapter[];
}

export interface SourceDiagnostic {
  source: string;
  ok: boolean;
  raw: number;
  error?: string;
}

interface RunSourceFetchResult {
  jobs: RawSourceJob[];
  diagnostics: SourceDiagnostic[];
}

export async function runSourceFetch(
  options: RunSourceFetchOptions,
): Promise<RunSourceFetchResult> {
  const lookup: ReadonlyMap<string, SourceAdapter> = options.adapters
    ? new Map(options.adapters.map((a) => [a.id, a]))
    : SOURCE_REGISTRY;

  const ctx = makeSourceContext();

  const results = await Promise.all(
    options.sources.map(async (source): Promise<SourceAdapterResult> => {
      const adapter = lookup.get(source);
      if (!adapter) {
        return { source, ok: false, jobs: [], error: "unknown_source" };
      }
      try {
        const jobs = await adapter.fetch(ctx);
        return { source, ok: true, jobs };
      } catch (err) {
        return {
          source,
          ok: false,
          jobs: [],
          error: err instanceof Error ? err.message : "adapter_throw",
        };
      }
    }),
  );

  // Cross-source dedup on the raw URL. importJobsForUser canonicalizes and
  // dedupes again, but doing it here keeps the diagnostics honest and shrinks
  // the payload before it reaches the DB.
  const seen = new Set<string>();
  const jobs: RawSourceJob[] = [];
  for (const result of results) {
    for (const item of result.jobs) {
      if (seen.has(item.jobUrl)) continue;
      seen.add(item.jobUrl);
      jobs.push(item);
    }
  }

  return {
    jobs,
    diagnostics: results.map((r) => ({
      source: r.source,
      ok: r.ok,
      raw: r.jobs.length,
      ...(r.error ? { error: r.error } : {}),
    })),
  };
}
