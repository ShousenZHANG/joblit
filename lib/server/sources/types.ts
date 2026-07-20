// Shared types for the global job-source pipeline. Adapters stay pure and
// unit-testable: they receive a context with an injected fetcher and return
// plain objects, never touching Prisma or the network directly.

/** A job discovered by an adapter, before dedup / tombstone filtering / DB
 *  write. Field names mirror ImportJobItemSchema's camelCase side so the
 *  orchestrator can hand these straight to importJobsForUser. */
export interface RawSourceJob {
  /** Absolute https URL. Used for canonicalization + dedup downstream. */
  jobUrl: string;
  title: string;
  company: string | null;
  location: string | null;
  jobType: string | null;
  jobLevel: string | null;
  description: string | null;
  salary: string | null;
  workArrangement: string | null;
  /** ISO-8601 timestamp when the posting went up, or null when unknown. */
  listingDate: string | null;
  /** Adapter id — becomes Job.source. */
  source: string;
}

/** What the orchestrator hands to an adapter. The injected fetcher is the only
 *  network access an adapter gets, which is what makes the host allowlist
 *  unbypassable and the adapter testable against a recorded payload. */
export interface SourceContext {
  fetchJson: (url: string, allowedHosts: readonly string[]) => Promise<unknown>;
}

export interface SourceAdapter {
  /** Unique across the registry. Persisted as Job.source. */
  id: string;
  /** Hosts this adapter is permitted to reach. Empty = it cannot fetch. */
  allowedHosts: readonly string[];
  fetch(ctx: SourceContext): Promise<RawSourceJob[]>;
}

/** Per-source outcome. A failing source never aborts the run — the user keeps
 *  whatever the other sources produced, plus a diagnostic line. */
export interface SourceAdapterResult {
  source: string;
  ok: boolean;
  jobs: RawSourceJob[];
  /** Populated when ok=false — short message for logs. */
  error?: string;
}
