import type { SourceAdapter } from "./types";
import remoteok from "./adapters/remoteok";
import remotive from "./adapters/remotive";
import jobicy from "./adapters/jobicy";

// Explicit registry rather than a directory scan: Next.js bundles server code,
// so a filesystem walk would not survive the build. Adding a source is one
// import plus one array entry.
const ADAPTERS: readonly SourceAdapter[] = [remoteok, remotive, jobicy];

export const SOURCE_REGISTRY: ReadonlyMap<string, SourceAdapter> = new Map(
  ADAPTERS.map((adapter) => [adapter.id, adapter]),
);

export const ALL_SOURCE_IDS: readonly string[] = ADAPTERS.map((a) => a.id);

export function isKnownSourceId(value: string): boolean {
  return SOURCE_REGISTRY.has(value);
}
