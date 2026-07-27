import type { RawSourceJob } from "./types";
import { violatesDescriptionExclusions } from "./descriptionExclusions";
import {
  isListingDateAcceptable,
  isTitleRelevant,
  isUnusableDescription,
  isUnusableTitle,
  isUsableJobUrl,
  matchesBaseQueryConstraints,
  normalizeRoleText,
} from "@/lib/shared/jobRelevance";

export type SourceJobFilter = {
  queries: string[];
  baseQueries?: string[];
  queryMode?: "query" | "source-only";
  location?: string | null;
  hoursOld?: number | null;
  excludeTitleTerms?: string[];
  excludeDescriptionRules?: string[];
  strictTitles?: boolean;
  now?: Date;
};

/**
 * Role matching is delegated to the shared matcher so GLOBAL, AU and CN answer
 * the same question the same way. This module keeps only what is specific to a
 * public feed: location, freshness and the description exclusion rules.
 */
function matchesRole(
  title: string,
  queries: readonly string[],
  baseQueries: readonly string[],
  strict: boolean,
): boolean {
  if (queries.length === 0) return false;
  if (!matchesBaseQueryConstraints(title, baseQueries)) return false;
  // Strict mode demands the title answer a requested query outright. Relaxed
  // mode additionally accepts a sibling role the base query's domain covers,
  // which the base constraint above has already verified.
  if (isTitleRelevant(title, queries)) return true;
  return !strict && baseQueries.length > 0 && isTitleRelevant(title, baseQueries);
}

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/([a-z0-9])([^\p{L}\p{N}]+)([a-z0-9])/gu, "$1 $3")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function matchesLocation(job: RawSourceJob, requestedLocation: string | null | undefined): boolean {
  if (!requestedLocation?.trim()) return true;
  const requested = normalize(requestedLocation);
  const requestedPrimary = normalize(requestedLocation.split(",")[0] ?? requestedLocation);
  const location = normalize(job.location ?? "");
  const workArrangement = normalize(job.workArrangement ?? "");
  const remote =
    /\b(remote|worldwide|anywhere)\b/.test(location) ||
    /\b(remote|worldwide|anywhere)\b/.test(workArrangement);
  const unrestrictedRemote =
    (remote && !location) ||
    location === "remote" ||
    /\b(worldwide|anywhere|global)\b/.test(location);

  if (requested === "remote") return remote;
  if (unrestrictedRemote) return true;
  if (!location) return false;
  return location.includes(requested) || Boolean(requestedPrimary && location.includes(requestedPrimary));
}

/**
 * Rows a public feed produces that are not roles at all: a scraped index page,
 * a login wall captured in place of a description, a link that cannot be
 * opened, a date that cannot be true.
 *
 * The AU worker has dropped these since it was written. GLOBAL did not, so the
 * junk reached the Jobs list and the user had to delete it by hand — and a
 * delete writes a permanent DeletedJobUrl tombstone, so the cost of importing
 * a bad row is not reversible.
 */
function isUsableRow(job: RawSourceJob): boolean {
  if (!isUsableJobUrl(job.jobUrl)) return false;
  if (isUnusableTitle(job.title)) return false;
  return !isUnusableDescription(job.description);
}

/**
 * Apply user intent before public-feed rows reach the shared importer.
 * Empty query sets fail closed unless the persisted config explicitly carries
 * the legacy `source-only` compatibility mode.
 */
export function filterSourceJobs(
  jobs: readonly RawSourceJob[],
  filter: SourceJobFilter,
): RawSourceJob[] {
  const excluded = (filter.excludeTitleTerms ?? [])
    .map((term) => normalizeRoleText(term).trim())
    .filter(Boolean);
  const queries = filter.queries.map((query) => query.trim()).filter(Boolean);
  const baseQueries = (filter.baseQueries ?? queries)
    .map((query) => query.trim())
    .filter(Boolean);
  const descriptionRules = filter.excludeDescriptionRules ?? [];
  const now = filter.now ?? new Date();

  return jobs.filter((job) => {
    if (!isUsableRow(job)) return false;
    const normalizedTitle = normalizeRoleText(job.title);
    if (excluded.some((term) => normalizedTitle.includes(term))) return false;
    if (
      filter.queryMode !== "source-only" &&
      !matchesRole(job.title, queries, baseQueries, filter.strictTitles !== false)
    ) {
      return false;
    }
    if (!matchesLocation(job, filter.location)) return false;
    if (!isListingDateAcceptable(job.listingDate, filter.hoursOld, now)) return false;
    return !violatesDescriptionExclusions(job.description, descriptionRules);
  });
}
