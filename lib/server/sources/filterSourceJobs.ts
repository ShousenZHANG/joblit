import type { RawSourceJob } from "./types";
import { violatesDescriptionExclusions } from "./descriptionExclusions";

export type SourceJobFilter = {
  queries: string[];
  baseQueries?: string[];
  location?: string | null;
  hoursOld?: number | null;
  excludeTitleTerms?: string[];
  excludeDescriptionRules?: string[];
  strictTitles?: boolean;
  now?: Date;
};

const GENERIC_ROLE_TOKENS = new Set([
  "application",
  "dev",
  "developer",
  "development",
  "engineer",
  "engineering",
  "full",
  "role",
  "software",
  "stack",
]);

const ROLE_TOKENS = new Set([
  "architect",
  "consultant",
  "developer",
  "engineer",
  "manager",
  "scientist",
  "specialist",
]);

const DOMAIN_FAMILIES: readonly ReadonlySet<string>[] = [
  new Set(["ai", "agent", "agentic", "genai", "llm", "ml", "machine", "learning"]),
  new Set(["api", "backend", "server"]),
  new Set(["frontend", "react", "web"]),
  new Set(["analytics", "data", "etl"]),
  new Set(["copilot", "dataverse", "dynamics", "power", "powerapps"]),
];

const COMPOUND_DOMAIN_FAMILIES = [
  {
    triggers: new Set(["power", "platform"]),
    members: new Set([
      "copilot",
      "d365",
      "dataverse",
      "dynamics",
      "power",
      "powerapps",
    ]),
  },
] as const;

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/([a-z0-9])([^\p{L}\p{N}]+)([a-z0-9])/gu, "$1 $3")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function tokenize(value: string): string[] {
  const normalized = normalize(value);
  return normalized ? normalized.split(" ") : [];
}

function hasMatchingDomainFamily(signal: string, titleTokens: ReadonlySet<string>): boolean {
  const family = DOMAIN_FAMILIES.find((entry) => entry.has(signal));
  return family ? [...family].some((token) => titleTokens.has(token)) : false;
}

function satisfiesBaseConstraint(
  titleTokens: ReadonlySet<string>,
  baseQueries: readonly string[],
): boolean {
  if (baseQueries.length === 0) return true;
  return baseQueries.some((query) => {
    const signals = tokenize(query).filter((token) => !GENERIC_ROLE_TOKENS.has(token));
    if (signals.length === 0) return true;
    if (
      COMPOUND_DOMAIN_FAMILIES.some(
        ({ triggers, members }) =>
          [...triggers].every((trigger) => signals.includes(trigger)) &&
          [...members].some((member) => titleTokens.has(member)),
      )
    ) {
      return true;
    }
    return signals.every(
      (signal) => titleTokens.has(signal) || hasMatchingDomainFamily(signal, titleTokens),
    );
  });
}

function matchesRole(
  title: string,
  queries: readonly string[],
  baseQueries: readonly string[],
  strict: boolean,
): boolean {
  if (queries.length === 0) return false;
  const titleTokens = new Set(tokenize(title));
  if (titleTokens.size === 0 || !satisfiesBaseConstraint(titleTokens, baseQueries)) {
    return false;
  }

  return queries.some((query) => {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return false;
    if (queryTokens.every((token) => titleTokens.has(token))) return true;
    if (strict) return false;

    const queryRoleTokens = queryTokens.filter((token) => ROLE_TOKENS.has(token));
    const sharesRole =
      queryRoleTokens.length === 0 ||
      queryRoleTokens.some((token) => titleTokens.has(token));
    const signals = queryTokens.filter(
      (token) => !GENERIC_ROLE_TOKENS.has(token) && !ROLE_TOKENS.has(token),
    );
    const sharesSignal =
      signals.length === 0 ||
      signals.some(
        (signal) => titleTokens.has(signal) || hasMatchingDomainFamily(signal, titleTokens),
      );
    return sharesRole && sharesSignal;
  });
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

function isFreshEnough(
  listingDate: string | null,
  hoursOld: number | null | undefined,
  now: Date,
): boolean {
  if (!hoursOld || hoursOld <= 0 || !listingDate) return true;
  const publishedAt = Date.parse(listingDate);
  if (Number.isNaN(publishedAt)) return true;
  return publishedAt >= now.getTime() - hoursOld * 60 * 60 * 1000;
}

/**
 * Apply user intent before public-feed rows reach the shared importer.
 * Empty query sets fail closed: a source-registry run must never import an
 * unrelated feed wholesale.
 */
export function filterSourceJobs(
  jobs: readonly RawSourceJob[],
  filter: SourceJobFilter,
): RawSourceJob[] {
  const excluded = (filter.excludeTitleTerms ?? [])
    .map(normalize)
    .filter(Boolean);
  const queries = filter.queries.map((query) => query.trim()).filter(Boolean);
  const baseQueries = (filter.baseQueries ?? queries)
    .map((query) => query.trim())
    .filter(Boolean);
  const descriptionRules = filter.excludeDescriptionRules ?? [];
  const now = filter.now ?? new Date();

  return jobs.filter((job) => {
    const normalizedTitle = normalize(job.title);
    if (excluded.some((term) => normalizedTitle.includes(term))) return false;
    if (!matchesRole(job.title, queries, baseQueries, filter.strictTitles !== false)) {
      return false;
    }
    if (!matchesLocation(job, filter.location)) return false;
    if (!isFreshEnough(job.listingDate, filter.hoursOld, now)) return false;
    return !violatesDescriptionExclusions(job.description, descriptionRules);
  });
}
