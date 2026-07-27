import { canonicalizeJobUrl } from "@/lib/shared/canonicalizeJobUrl";
import { isTitleRelevant } from "@/lib/shared/jobRelevance";
import type { RawCnJob } from "./types";

// Normalization layer: RawCnJob[] → insert-ready rows for prisma.job.createMany.
// Responsible for:
//   - Canonicalizing URLs (strip tracking params, sort query) so dedup works
//     across sources that link to the same posting with different tags.
//   - Tightening location / jobType / jobLevel strings (trim, cap length).
//   - Applying keyword include/exclude filters supplied by the user's
//     FetchRun config. Title relevance itself belongs to
//     lib/shared/jobRelevance, which every market shares; this module kept a
//     partial port of it that had no domain synonym classes, so a CN query
//     matched only titles repeating its own literal tokens.
//   - Running cross-source dedup by canonical URL.
//
// Pure TypeScript — no I/O. Safe to unit-test.

interface NormalizeOptions {
  /** User's role queries. A title must match one when supplied. */
  queries?: string[];
  /** User's exclude keywords. Any match drops the job (hard filter). */
  excludeKeywords?: string[];
  /** Optional city filter. When non-empty, the job's location must contain one
   *  of these (hard filter — the user explicitly asked for that city). */
  locations?: string[];
}

export interface NormalizedCnJob {
  jobUrl: string;
  title: string;
  company: string | null;
  location: string | null;
  jobType: string | null;
  jobLevel: string | null;
  description: string | null;
  listingDate: string | null;
  market: "CN";
  source: RawCnJob["source"];
}

const MAX_FIELD_LEN = 200;
const MAX_DESC_LEN = 8000;
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsTerm(haystack: string, rawNeedle: string): boolean {
  const needle = rawNeedle.normalize("NFKC").trim().toLowerCase();
  if (!needle) return false;
  const body = haystack.normalize("NFKC").toLowerCase();

  if (/[\u3400-\u9fff]/u.test(needle)) return body.includes(needle);

  const phrase = needle
    .split(/[\s\-_/.]+/)
    .filter(Boolean)
    .map(escapeRegExp)
    .join("[\\s\\-_/.]+");
  if (!phrase) return false;
  return new RegExp(`(?:^|[^a-z0-9])${phrase}(?=$|[^a-z0-9])`, "iu").test(
    body,
  );
}

function containsAny(
  haystack: string,
  needles: readonly string[],
): boolean {
  if (needles.length === 0) return false;
  return needles.some((needle) => containsTerm(haystack, needle));
}

function normalizeListingDate(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function normalizeCnJobs(
  raw: RawCnJob[],
  options: NormalizeOptions = {},
): NormalizedCnJob[] {
  const queries = expandCnQueries(options.queries ?? []);
  const excludeKeywords = (options.excludeKeywords ?? [])
    .map((k) => k.trim())
    .filter(Boolean);
  const locations = (options.locations ?? [])
    .map((k) => k.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const matched: NormalizedCnJob[] = [];

  for (const r of raw) {
    const canonical = canonicalizeJobUrl(r.jobUrl ?? "");
    if (!canonical) continue;

    const title = tightenString(r.title);
    if (!title) continue;

    const company = tightenString(r.company);
    const location = tightenString(r.location);
    const description = tightenString(r.description, MAX_DESC_LEN);

    // Exclusion filter — drop on any exclude hit (never surface excluded content).
    if (excludeKeywords.length > 0) {
      const haystack = `${title} ${description ?? ""} ${company ?? ""}`;
      if (containsAny(haystack, excludeKeywords)) continue;
    }

    // Location filter — hard filter when the user named cities.
    if (locations.length > 0 && !containsAny(location ?? "", locations)) {
      continue;
    }

    if (queries.length > 0 && !isTitleRelevant(title, queries)) continue;
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    const normalized: NormalizedCnJob = {
      jobUrl: canonical,
      title,
      company,
      location,
      jobType: tightenString(r.jobType),
      jobLevel: tightenString(r.jobLevel),
      description,
      listingDate: normalizeListingDate(r.publishedAt),
      market: "CN",
      source: r.source,
    };

    matched.push(normalized);
  }

  return matched;
}
