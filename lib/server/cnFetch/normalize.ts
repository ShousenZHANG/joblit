import { canonicalizeJobUrl } from "@/lib/shared/canonicalizeJobUrl";
import type { RawCnJob } from "./types";

// Normalization layer: RawCnJob[] → insert-ready rows for prisma.job.createMany.
// Responsible for:
//   - Canonicalizing URLs (strip tracking params, sort query) so dedup works
//     across sources that link to the same posting with different tags.
//   - Tightening location / jobType / jobLevel strings (trim, cap length).
//   - Applying keyword include/exclude filters supplied by the user's
//     FetchRun config.
//   - Running cross-source dedup by canonical URL.
//
// Pure TypeScript — no I/O. Safe to unit-test.

export interface NormalizeOptions {
  /** User's query keywords. If non-empty, the job must match at least one
   *  (case-insensitive, anywhere in title/description). */
  queries?: string[];
  /** User's exclude keywords. Any match drops the job. */
  excludeKeywords?: string[];
}

export interface NormalizedCnJob {
  jobUrl: string;
  title: string;
  company: string | null;
  location: string | null;
  jobType: string | null;
  jobLevel: string | null;
  description: string | null;
  market: "CN";
  source: RawCnJob["source"];
}

const MAX_FIELD_LEN = 200;
const MAX_DESC_LEN = 8000;

// Common Chinese job-title suffixes. Chinese recruitment posts almost
// always use short-form titles ("前端", "后端", "全栈") inside bracket
// tags like [Acme][前端][上海], but users type the long formal name
// ("全栈开发工程师") into the keyword box. Without expansion the include
// filter drops everything. We strip trailing suffixes so a query like
// "全栈开发工程师" also matches "全栈" anywhere in title/description.
const CN_TITLE_SUFFIXES = [
  "开发工程师",
  "高级工程师",
  "工程师",
  "开发",
  "程序员",
  "技术专家",
  "架构师",
];

/** Expand each query by adding the suffix-stripped base term. */
export function expandCnQueries(queries: readonly string[]): string[] {
  const out = new Set<string>();
  for (const raw of queries) {
    const q = raw.trim();
    if (!q) continue;
    out.add(q);
    for (const suffix of CN_TITLE_SUFFIXES) {
      if (q.endsWith(suffix) && q.length > suffix.length) {
        const base = q.slice(0, -suffix.length).trim();
        if (base.length >= 2) {
          out.add(base);
          break; // strip only the longest matching suffix
        }
      }
    }
  }
  return Array.from(out);
}

function tightenString(
  value: string | null | undefined,
  max = MAX_FIELD_LEN,
): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function containsAny(
  haystack: string,
  needles: readonly string[],
): boolean {
  if (needles.length === 0) return false;
  const lowerHay = haystack.toLowerCase();
  return needles.some((n) => {
    const needle = n.trim().toLowerCase();
    return needle.length > 0 && lowerHay.includes(needle);
  });
}

export function normalizeCnJobs(
  raw: RawCnJob[],
  options: NormalizeOptions = {},
): NormalizedCnJob[] {
  const queries = expandCnQueries(options.queries ?? []);
  const excludeKeywords = (options.excludeKeywords ?? [])
    .map((k) => k.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const strict: NormalizedCnJob[] = []; // passes keyword include filter
  const relaxed: NormalizedCnJob[] = []; // passes exclude filter only

  for (const r of raw) {
    const canonical = canonicalizeJobUrl(r.jobUrl ?? "");
    if (!canonical) continue;
    if (seen.has(canonical)) continue;

    const title = tightenString(r.title);
    if (!title) continue;

    const company = tightenString(r.company);
    const location = tightenString(r.location);
    const description = tightenString(r.description, MAX_DESC_LEN);

    // Exclusion filter: drop on any exclude hit — applies to BOTH strict
    // and relaxed pools (never surface explicitly-excluded content).
    if (excludeKeywords.length > 0) {
      const haystack = `${title} ${description ?? ""} ${company ?? ""}`;
      if (containsAny(haystack, excludeKeywords)) continue;
    }

    seen.add(canonical);
    const normalized: NormalizedCnJob = {
      jobUrl: canonical,
      title,
      company,
      location,
      jobType: tightenString(r.jobType),
      jobLevel: tightenString(r.jobLevel),
      description,
      market: "CN",
      source: r.source,
    };

    relaxed.push(normalized);

    // Keyword match: at least one expanded query token appears in
    // title+description (case-insensitive substring). If no queries were
    // given, the strict pool equals the relaxed pool.
    if (queries.length === 0) {
      strict.push(normalized);
      continue;
    }
    const haystack = `${title} ${description ?? ""}`;
    if (containsAny(haystack, queries)) strict.push(normalized);
  }

  // Soft fallback: on thin aggregator days the strict pool can be empty
  // even for reasonable queries. Return the full deduped+excluded pool so
  // the user still sees something actionable instead of "Imported 0".
  return strict.length > 0 ? strict : relaxed;
}
