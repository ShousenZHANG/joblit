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
  const queries = (options.queries ?? []).map((q) => q.trim()).filter(Boolean);
  const excludeKeywords = (options.excludeKeywords ?? [])
    .map((k) => k.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const out: NormalizedCnJob[] = [];

  for (const r of raw) {
    const canonical = canonicalizeJobUrl(r.jobUrl ?? "");
    if (!canonical) continue;
    if (seen.has(canonical)) continue;

    const title = tightenString(r.title);
    if (!title) continue;

    const company = tightenString(r.company);
    const location = tightenString(r.location);
    const description = tightenString(r.description, MAX_DESC_LEN);

    // Keyword filter: if user supplied queries, require at least one match
    // in title/description (Chinese + English both work via substring).
    if (queries.length > 0) {
      const haystack = `${title} ${description ?? ""}`;
      if (!containsAny(haystack, queries)) continue;
    }

    // Exclusion filter: drop on any exclude hit.
    if (excludeKeywords.length > 0) {
      const haystack = `${title} ${description ?? ""} ${company ?? ""}`;
      if (containsAny(haystack, excludeKeywords)) continue;
    }

    seen.add(canonical);
    out.push({
      jobUrl: canonical,
      title,
      company,
      location,
      jobType: tightenString(r.jobType),
      jobLevel: tightenString(r.jobLevel),
      description,
      market: "CN",
      source: r.source,
    });
  }

  return out;
}
