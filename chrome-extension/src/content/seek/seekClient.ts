// Pure Seek helpers — no DOM, no network — so they unit-test cleanly.
//
// We do NOT replay Seek's JobSearchV6 query (the gateway rejects ad-hoc
// queries as UNSTABLE_QUERY_ERROR). The MAIN-world interceptor
// (seekInterceptMain) captures the rows the Seek frontend itself loads; this
// module only (a) maps one captured row to the import-item shape and (b) tells
// the scraper which URLs are search pages worth showing the button on.

import type { SeekImportItem } from "@ext/shared/types";

const SEEK_ID_RE = /^\d+$/;

/** Map one captured JobSearchV6 row to the import-item shape. Returns null for
 *  rows without a numeric id / title (the numeric id also closes the
 *  URL-injection vector, matching the server `map_job`). */
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
