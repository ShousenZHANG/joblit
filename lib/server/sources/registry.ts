import type { SourceAdapter } from "./types";
import remoteok from "./adapters/remoteok";
import remotive from "./adapters/remotive";
import jobicy from "./adapters/jobicy";
import { createAtsAdapters } from "./adapters/ats";
import {
  parseAtsBoardRegistryJson,
  type AtsBoardConfig,
  type AtsBoardRegistryIssue,
} from "./atsBoards";

const CORE_ADAPTERS: readonly SourceAdapter[] = [remoteok, remotive, jobicy];
const atsConfig = parseAtsBoardRegistryJson(
  process.env.JOBLIT_ATS_BOARDS_JSON,
);

const atsIssues: AtsBoardRegistryIssue[] = [...atsConfig.issues];
const ids = new Set(CORE_ADAPTERS.map((adapter) => adapter.id));
const acceptedAtsIds = new Set<string>();
const ATS_ADAPTERS = createAtsAdapters(atsConfig.boards).filter((adapter) => {
  if (ids.has(adapter.id)) {
    atsIssues.push({
      index: null,
      code: "duplicate_id",
      message: `ATS source id "${adapter.id}" conflicts with a core source`,
    });
    return false;
  }
  ids.add(adapter.id);
  acceptedAtsIds.add(adapter.id);
  return true;
});

/**
 * Configuration problems remain observable but never replace a core source.
 * A colliding custom id is skipped, keeping registry construction fail-safe.
 */
export const ATS_BOARD_REGISTRY_ISSUES: readonly AtsBoardRegistryIssue[] =
  atsIssues;
export const ATS_BOARD_CONFIGS: readonly AtsBoardConfig[] =
  atsConfig.boards.filter((board) => acceptedAtsIds.has(board.id));

// Explicit core registry plus deployment-owned ATS tenants. No directory scan:
// Next.js bundles server code, so filesystem discovery would not survive.
export const SOURCE_ADAPTERS: readonly SourceAdapter[] = [
  ...CORE_ADAPTERS,
  ...ATS_ADAPTERS,
];

export const SOURCE_REGISTRY: ReadonlyMap<string, SourceAdapter> = new Map(
  SOURCE_ADAPTERS.map((adapter) => [adapter.id, adapter]),
);

export const ALL_SOURCE_IDS: readonly string[] = SOURCE_ADAPTERS.map(
  (adapter) => adapter.id,
);

export function isKnownSourceId(value: string): boolean {
  return SOURCE_REGISTRY.has(value);
}
