import manifest from "@/lib/shared/fetchRolePacks.config.json";

/**
 * AU title relevance shared by the TypeScript prescreen and Python worker.
 * Both implementations read `fetchRolePacks.config.json` and execute the same
 * conformance corpus so a rule change cannot silently shrink the job list.
 */

/**
 * How hard the title filter presses.
 *
 * Naming strict, relaxed and off keeps old AU rows readable while making the
 * worker's matching intent explicit.
 */
export const TITLE_MATCH_MODES = ["strict", "relaxed", "off"] as const;
export type TitleMatchMode = (typeof TITLE_MATCH_MODES)[number];

export function isTitleMatchMode(value: unknown): value is TitleMatchMode {
  return (
    typeof value === "string" &&
    (TITLE_MATCH_MODES as readonly string[]).includes(value)
  );
}

/**
 * Read the mode from a stored config, falling back to the legacy boolean.
 *
 * Legacy `false` maps to `off` because that is what the UI promised — the
 * control read "Strict title match … turn off to cast a wider net" — and what
 * AU already did.
 */
export function resolveTitleMatchMode(input: {
  titleMatch?: unknown;
  includeFromQueries?: unknown;
}): TitleMatchMode {
  if (isTitleMatchMode(input.titleMatch)) return input.titleMatch;
  return input.includeFromQueries === false ? "off" : "strict";
}

type CompoundFamily = { triggers: string[]; members: string[] };

type RelevanceManifest = {
  roleTokens: string[];
  roleNoiseTokens: string[];
  cjkRoleTerms: string[];
  cjkRoleNoiseTerms: string[];
  domainClasses: Record<string, string[]>;
  signalClasses: Record<string, string>;
  domainOnlyClasses: string[];
  compoundDomainFamilies: CompoundFamily[];
  invalidTitlePattern: string;
  invalidDescriptionPattern: string;
  listingFutureGraceHours: number;
  listingAgeGraceHours: number;
};

const RELEVANCE = (manifest as { relevance: RelevanceManifest }).relevance;

const GENERIC_TOKENS = new Set(
  (manifest as { genericTokens: string[] }).genericTokens.map((t) => t.toLowerCase()),
);
const ROLE_TOKENS = new Set(RELEVANCE.roleTokens);
const ROLE_NOISE_TOKENS = new Set(RELEVANCE.roleNoiseTokens);
const CJK_ROLE_TERMS = RELEVANCE.cjkRoleTerms;
const CJK_ROLE_NOISE_TERMS = RELEVANCE.cjkRoleNoiseTerms;

/** signal token -> every synonym in its domain class. */
const SIGNAL_SYNONYMS = new Map<string, readonly string[]>(
  Object.entries(RELEVANCE.signalClasses).map(([signal, className]) => [
    signal,
    RELEVANCE.domainClasses[className] ?? [signal],
  ]),
);

/**
 * A base query whose every signal names a domain ("AI Engineer" -> "ai") says
 * which field the user is hiring into, not which stack a candidate must have.
 * Those defer to the include filter, which has already matched the title
 * against the expanded role pack. A query naming a concrete technology
 * ("Java backend developer" -> "java") is a different claim and stays pinned.
 */
const DOMAIN_ONLY_SIGNALS = new Set(
  RELEVANCE.domainOnlyClasses.flatMap((name) => RELEVANCE.domainClasses[name] ?? []),
);

const COMPOUND_FAMILIES: readonly { triggers: Set<string>; members: string[] }[] =
  RELEVANCE.compoundDomainFamilies.map((family) => ({
    triggers: new Set(family.triggers),
    members: family.members,
  }));

const INVALID_TITLE_RE = new RegExp(RELEVANCE.invalidTitlePattern, "i");
const INVALID_DESCRIPTION_RE = new RegExp(RELEVANCE.invalidDescriptionPattern, "i");

const CJK_RANGE = /[㐀-鿿]/u;

/**
 * Fold the separator and abbreviation variants that mean the same role, so
 * "full-stack" matches "full stack" and a standalone "ML" matches
 * "machine learning".
 */
export function normalizeRoleText(value: string): string {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\bfront[\s-]*end\b/g, "frontend")
    .replace(/\bback[\s-]*end\b/g, "backend")
    .replace(/\bfull[\s-]*stack\b/g, "fullstack")
    .replace(/\bml\b/g, "machine learning");
}

function roleTokens(value: string): string[] {
  return normalizeRoleText(value).match(/[a-z][a-z0-9+#.]*/g) ?? [];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whole-term containment, separator-insensitive. CJK has no word boundaries,
 * so it falls back to substring containment.
 */
export function containsTitleTerm(haystack: string, rawNeedle: string): boolean {
  const needle = normalizeRoleText(rawNeedle).trim();
  if (!needle) return false;
  const body = normalizeRoleText(haystack);
  if (CJK_RANGE.test(needle)) return body.includes(needle);

  const parts = needle.split(/[\s\-_/.]+/).filter(Boolean);
  if (parts.length === 0) return false;
  const phrase = parts.map(escapeRegExp).join("[\\s\\-_/.]+");
  return new RegExp(`(?<![a-z0-9])${phrase}(?![a-z0-9])`).test(body);
}

function hasRoleMarker(value: string): boolean {
  const normalized = normalizeRoleText(value);
  return (
    roleTokens(normalized).some((token) => ROLE_TOKENS.has(token)) ||
    CJK_ROLE_TERMS.some((term) => normalized.includes(term))
  );
}

/**
 * Domain signals carried by a query, with the role words and the seniority
 * words removed.
 *
 * Dropping `ROLE_NOISE_TOKENS` here is the fix for the 12-to-1 collapse:
 * "senior" states a level, not a domain, so it must never become a term the
 * title has to contain.
 */
function asciiRoleSignals(value: string): string[] {
  return roleTokens(value).filter(
    (token) => !ROLE_TOKENS.has(token) && !ROLE_NOISE_TOKENS.has(token),
  );
}

/** Signals that actually narrow the search — generic words cannot. */
function requiredAsciiRoleSignals(value: string): string[] {
  return asciiRoleSignals(value).filter((token) => !GENERIC_TOKENS.has(token));
}

function cjkRoleSignals(value: string): string[] {
  let normalized = normalizeRoleText(value).replace(/[a-z][a-z0-9+#.]*/g, " ");
  for (const term of [...CJK_ROLE_TERMS, ...CJK_ROLE_NOISE_TERMS]) {
    normalized = normalized.split(term).join(" ");
  }
  return normalized.match(/[㐀-鿿]+/gu) ?? [];
}

/**
 * True when the query's signals trigger a multi-token family and the title
 * carries any member. Keyed on the token *combination*: "Power Platform"
 * roles are named by product ("Copilot Studio Developer"), and a single-token
 * class would hand a plain "Platform Engineer" search the whole Microsoft
 * catalogue.
 */
function matchesDomainFamily(title: string, signals: readonly string[]): boolean {
  const signalSet = new Set(signals);
  return COMPOUND_FAMILIES.some(
    (family) =>
      [...family.triggers].every((trigger) => signalSet.has(trigger)) &&
      family.members.some((member) => containsTitleTerm(title, member)),
  );
}

/** A signal matches when the title contains it or any synonym in its class. */
function signalInTitle(title: string, signal: string): boolean {
  const candidates = SIGNAL_SYNONYMS.get(signal) ?? [signal];
  return candidates.some((candidate) => containsTitleTerm(title, candidate));
}

function baseQueryIsDomainOnly(signals: readonly string[]): boolean {
  return signals.length > 0 && signals.every((signal) => DOMAIN_ONLY_SIGNALS.has(signal));
}

/** Does this title answer any of the requested queries? */
export function isTitleRelevant(title: string, queries: readonly string[]): boolean {
  for (const query of queries) {
    if (containsTitleTerm(title, query)) return true;
    if (!hasRoleMarker(query) || !hasRoleMarker(title)) continue;

    const ascii = requiredAsciiRoleSignals(query);
    const cjk = cjkRoleSignals(query);
    // A wholly generic query ("Software Engineer") names no domain to narrow
    // on, so any titled engineering role is a legitimate hit.
    if (ascii.length === 0 && cjk.length === 0) return true;

    if (
      !ascii.every((signal) => signalInTitle(title, signal)) &&
      !matchesDomainFamily(title, ascii)
    ) {
      continue;
    }
    const normalizedTitle = normalizeRoleText(title);
    if (cjk.every((signal) => normalizedTitle.includes(signal))) return true;
  }
  return false;
}

/** Does this title stay inside the domain the user's own base query named? */
export function matchesBaseQueryConstraints(
  title: string,
  baseQueries: readonly string[],
): boolean {
  const normalizedTitle = normalizeRoleText(title);
  for (const query of baseQueries) {
    const ascii = requiredAsciiRoleSignals(query);
    const cjk = cjkRoleSignals(query);
    if (ascii.length === 0 && cjk.length === 0) return true;

    if (
      !ascii.every((signal) => signalInTitle(title, signal)) &&
      !matchesDomainFamily(title, ascii)
    ) {
      if (!baseQueryIsDomainOnly(ascii)) continue;
    }
    if (cjk.every((signal) => normalizedTitle.includes(signal))) return true;
  }
  return false;
}

/** A scraped index page rather than a role. */
export function isUnusableTitle(title: string | null | undefined): boolean {
  const value = String(title ?? "").trim();
  return value.length < 2 || INVALID_TITLE_RE.test(value);
}

/** A login wall, bot check or error page captured instead of a description. */
export function isUnusableDescription(description: string | null | undefined): boolean {
  const value = String(description ?? "").trim();
  return value.length > 0 && INVALID_DESCRIPTION_RE.test(value);
}

/** Only absolute http(s) links are usable: they are persisted and opened. */
export function isUsableJobUrl(url: string | null | undefined): boolean {
  const value = String(url ?? "").trim();
  if (!value) return false;
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

export const LISTING_FUTURE_GRACE_HOURS = RELEVANCE.listingFutureGraceHours;
export const LISTING_AGE_GRACE_HOURS = RELEVANCE.listingAgeGraceHours;

/**
 * Freshness with the same tolerances the AU worker uses: a grace window on the
 * old side because feeds report dates at day precision in an unknown zone, and
 * a hard ceiling on the new side because a listing dated in the future is a
 * parse error, not a fresh role.
 */
export function isListingDateAcceptable(
  listingDate: string | null | undefined,
  hoursOld: number | null | undefined,
  now: Date,
): boolean {
  if (!listingDate) return true;
  const published = Date.parse(listingDate);
  if (Number.isNaN(published)) return true;

  const futureCutoff = now.getTime() + LISTING_FUTURE_GRACE_HOURS * 3_600_000;
  if (published > futureCutoff) return false;

  if (!hoursOld || hoursOld <= 0) return true;
  const oldCutoff =
    now.getTime() - (hoursOld + LISTING_AGE_GRACE_HOURS) * 3_600_000;
  return published >= oldCutoff;
}
