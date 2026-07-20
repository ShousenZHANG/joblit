import { safeOutboundFetch } from "@/lib/server/net/safeFetch";

/**
 * On-demand full-JD fetch for Seek jobs.
 *
 * Seek jobs are imported via the browser extension, which captures only the
 * short teaser description. When a Seek job is actually tailored (Generate
 * CV/CL), we fetch its FULL job description once, server-side, so the tailoring
 * prompt gets the complete JD.
 *
 * Source: a single POST to au.seek.com/graphql (the consumer BFF, which accepts
 * ad-hoc queries) — NOT the Cloudflare-challenged *.cloud.seek.com.au gateway.
 * One request, honest User-Agent, gated by SEEK_FETCH_ENABLED, SSRF-guarded to
 * numeric au.seek.com job ids, and fully graceful (returns null on any problem
 * so the caller falls back to the teaser).
 *
 * ToS note: honest identification, no challenge solving, no proxy rotation;
 * on-demand volume is tiny (only at tailoring time).
 */
const SEEK_HOST = "au.seek.com";
const SEEK_ORIGIN = `https://${SEEK_HOST}`;
const SEEK_GRAPHQL_URL = `${SEEK_ORIGIN}/graphql`;
// On the Generate CV/CL hot path — keep tight so a slow Seek can't add much
// latency before falling back to the teaser.
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_DESCRIPTION = 50_000;

// Below this many chars a stored Seek description is treated as a teaser worth
// upgrading to the full JD.
export const SEEK_THIN_DESCRIPTION = 600;

function userAgent(): string {
  return process.env.SEEK_USER_AGENT?.trim() || "Joblit-Fetcher/1.0 (+https://www.joblit.tech)";
}

function seekFetchEnabled(): boolean {
  const v = (process.env.SEEK_FETCH_ENABLED || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function extractSeekJobId(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname.toLowerCase() !== SEEK_HOST) return null;
    const match = u.pathname.match(/^\/job\/(\d+)$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export function isSeekJobUrl(url: string | null | undefined): boolean {
  return extractSeekJobId(url) !== null;
}

export function shouldEnrichSeekDescription(
  jobUrl: string | null | undefined,
  description: string | null | undefined,
): boolean {
  return isSeekJobUrl(jobUrl) && (description ?? "").trim().length < SEEK_THIN_DESCRIPTION;
}

function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|ul|ol|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_DESCRIPTION);
}

/**
 * Fetch the full JD for a Seek job URL, or null if disabled / not a Seek job /
 * unavailable. Never throws.
 */
export async function fetchSeekJobDescription(jobUrl: string): Promise<string | null> {
  if (!seekFetchEnabled()) return null;
  const id = extractSeekJobId(jobUrl); // numeric-id SSRF guard
  if (!id) return null;
  try {
    const res = await safeOutboundFetch(
      SEEK_GRAPHQL_URL,
      {
        method: "POST",
        headers: {
          "User-Agent": userAgent(),
          "Content-Type": "application/json",
          Accept: "application/json",
          Origin: SEEK_ORIGIN,
          Referer: `${SEEK_ORIGIN}/job/${id}`,
        },
        // id is \d+ only, so this interpolation cannot inject GraphQL.
        body: JSON.stringify({ query: `{ jobDetails(id: "${id}") { job { content } } }` }),
      },
      {
        allowedHosts: [SEEK_HOST],
        maxRedirects: 0,
        maxResponseBytes: 1024 * 1024,
        timeoutMs: REQUEST_TIMEOUT_MS,
      },
    );
    if (!res.ok) return null;
    const json = (await res.json().catch(() => null)) as
      | { data?: { jobDetails?: { job?: { content?: unknown } } } }
      | null;
    const content = json?.data?.jobDetails?.job?.content;
    if (typeof content !== "string" || !content.trim()) return null;
    const text = stripHtml(content);
    return text.length >= 40 ? text : null;
  } catch {
    return null;
  }
}
