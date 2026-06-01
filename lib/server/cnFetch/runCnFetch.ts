import type { AdapterResult, CnSource } from "./types";
import { fetchNowcoderJobs } from "./adapters/nowcoder";
import { normalizeCnJobs, type NormalizedCnJob } from "./normalize";

// Multi-source orchestrator. Runs each enabled adapter in parallel (so a
// slow source can't block the cron), merges results, then normalizes +
// dedups. Per-source failures do not abort the run — the user still gets
// whatever the other sources produced, plus a diagnostics report.

export type CnFetchAdapter = (signal?: AbortSignal) => Promise<AdapterResult>;

export interface RunCnFetchOptions {
  /** Sources to include. Only "nowcoder" is supported; defaults to it. */
  sources?: CnSource[];
  /** User's keyword filter (applied in normalize). */
  queries?: string[];
  /** User's exclusion filter (applied in normalize). */
  excludeKeywords?: string[];
  /** Test seam: override adapters by source. */
  adapters?: Partial<Record<CnSource, () => Promise<AdapterResult>>>;
}

export interface RunCnFetchResult {
  jobs: NormalizedCnJob[];
  diagnostics: Array<{
    source: CnSource;
    ok: boolean;
    raw: number;
    error?: string;
  }>;
}

const DEFAULT_SOURCES: CnSource[] = ["nowcoder"];

function defaultAdapterFor(_source: CnSource): () => Promise<AdapterResult> {
  // Nowcoder is the only source.
  return () => fetchNowcoderJobs();
}

export async function runCnFetch(
  options: RunCnFetchOptions = {},
): Promise<RunCnFetchResult> {
  const sources =
    options.sources && options.sources.length > 0
      ? options.sources
      : DEFAULT_SOURCES;

  // Parallel — one slow adapter can't block the others.
  const adapterResults = await Promise.all(
    sources.map((src) => {
      const adapter =
        options.adapters?.[src] ?? defaultAdapterFor(src);
      // Each adapter is already wrapped in try/catch internally, but double-
      // wrap here so a buggy user-supplied test adapter can't crash the run.
      return adapter().catch(
        (err): AdapterResult => ({
          source: src,
          ok: false,
          jobs: [],
          error: err instanceof Error ? err.message : "adapter_throw",
        }),
      );
    }),
  );

  const rawJobs = adapterResults.flatMap((r) => r.jobs);
  const normalized = normalizeCnJobs(rawJobs, {
    queries: options.queries,
    excludeKeywords: options.excludeKeywords,
  });

  return {
    jobs: normalized,
    diagnostics: adapterResults.map((r) => ({
      source: r.source,
      ok: r.ok,
      raw: r.jobs.length,
      ...(r.error ? { error: r.error } : {}),
    })),
  };
}
