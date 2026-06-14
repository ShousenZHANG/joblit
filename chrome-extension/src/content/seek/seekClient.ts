// Pure Seek graphql helpers — no DOM, no network — so they unit-test cleanly.
// Mirrors the server worker's JobSearchV6 query + mapping (ADR-0003); the
// difference is WHERE it runs: in the user's logged-in browser (residential
// IP + real session), which is what clears Cloudflare.

import type { SeekImportItem } from "@ext/shared/types";

export const SEEK_GRAPHQL_URL = "https://au.seek.com/graphql";

// Trimmed JobSearchV6 — only the fields mapSeekJob consumes.
export const JOB_SEARCH_V6_QUERY =
  "query JobSearchV6($params: JobSearchV6QueryInput!) {" +
  " jobSearchV6(params: $params) {" +
  " data { id title teaser companyName salaryLabel workTypes" +
  " advertiser { description } bulletPoints" +
  " listingDate { dateTimeUtc } locations { label }" +
  " workArrangements { displayText } }" +
  " totalCount } }";

const SEEK_ID_RE = /^\d+$/;

export interface JobSearchV6Variables {
  params: {
    channel: string;
    include: string[];
    locale: string;
    page: number;
    pageSize: number;
    siteKey: string;
    source: string;
    keywords?: string;
  };
}

/** Build JobSearchV6 variables from only the live-confirmed input fields. */
export function buildSeekVariables(
  keywords: string,
  page = 1,
  pageSize = 100,
): JobSearchV6Variables {
  const params: JobSearchV6Variables["params"] = {
    channel: "web",
    include: ["seoData", "gptTargeting", "relatedSearches"],
    locale: "en-AU",
    page,
    pageSize,
    siteKey: "AU",
    source: "FE_SERP",
  };
  const kw = keywords.trim();
  if (kw) params.keywords = kw;
  return { params };
}

interface JobSearchV6Parsed {
  jobs: unknown[];
  totalCount: number;
}

/** Pull the listings array + totalCount out of a JobSearchV6 response. */
export function parseJobSearchV6(payload: unknown): JobSearchV6Parsed {
  const root =
    payload && typeof payload === "object"
      ? (payload as { data?: { jobSearchV6?: { data?: unknown; totalCount?: unknown } } }).data
          ?.jobSearchV6
      : undefined;
  const jobs = Array.isArray(root?.data) ? (root!.data as unknown[]) : [];
  return { jobs, totalCount: Number(root?.totalCount ?? 0) };
}

/** Map one JobSearchV6 row to the import-item shape. Returns null for rows
 *  without a numeric id / title (the numeric id also closes the URL-injection
 *  vector, matching the server `map_job`). */
export function mapSeekJob(raw: unknown): SeekImportItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = String(r.id ?? "");
  const title = String(r.title ?? "").trim();
  if (!SEEK_ID_RE.test(id) || !title) return null;

  const advertiser = r.advertiser as { description?: unknown } | undefined;
  const company =
    String(advertiser?.description ?? r.companyName ?? "").trim() || null;

  const locations = r.locations as Array<{ label?: unknown }> | undefined;
  const location =
    Array.isArray(locations) && locations[0]?.label
      ? String(locations[0].label).trim() || null
      : null;

  const workTypes = r.workTypes as unknown[] | undefined;
  const jobType = Array.isArray(workTypes)
    ? workTypes.map((w) => String(w).trim()).filter(Boolean).join(", ") || null
    : null;

  const teaser = String(r.teaser ?? "").trim();
  const bullets = Array.isArray(r.bulletPoints)
    ? (r.bulletPoints as unknown[])
        .map((b) => String(b).trim())
        .filter(Boolean)
        .map((b) => `- ${b}`)
        .join("\n")
    : "";
  const description = [teaser, bullets].filter(Boolean).join("\n") || null;

  const wa = r.workArrangements as { displayText?: unknown } | undefined;
  const workArrangement = wa?.displayText
    ? String(wa.displayText).trim() || null
    : null;

  const ld = r.listingDate as { dateTimeUtc?: unknown } | undefined;
  const listingDate = ld?.dateTimeUtc ? String(ld.dateTimeUtc) : null;

  return {
    jobUrl: `https://au.seek.com/job/${id}`,
    title,
    company,
    location,
    jobType,
    description,
    salary: String(r.salaryLabel ?? "").trim() || null,
    workArrangement,
    listingDate,
    site: "seek",
  };
}

/** Derive the search keywords from a Seek SERP URL (query param or SEO path). */
export function extractSeekKeywords(href: string): string {
  try {
    const u = new URL(href);
    const kw = u.searchParams.get("keywords");
    if (kw && kw.trim()) return kw.trim();
    // SEO path form: /software-engineer-jobs, /data-analyst-jobs/in-Sydney
    const m = u.pathname.match(/^\/([a-z0-9-]+)-jobs/i);
    if (m) return m[1].replace(/-/g, " ").trim();
    return "";
  } catch {
    return "";
  }
}

/** True for a Seek search-results URL (where importing makes sense). */
export function isSeekSearchUrl(href: string): boolean {
  try {
    const u = new URL(href);
    if (u.hostname.toLowerCase() !== "au.seek.com") return false;
    return u.pathname === "/jobs" || /-jobs(\/|$)/i.test(u.pathname);
  } catch {
    return false;
  }
}
