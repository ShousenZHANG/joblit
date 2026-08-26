// Canonicalize job URLs so we can dedupe reliably across tracking variants.
// Big-tech default: prefer a stable external identifier when available.

const LINKEDIN_VIEW_RE = /\/jobs\/view\/(\d+)/i;
const IDENTITY_QUERY_GROUPS = [
  { canonical: "gh_jid", aliases: ["gh_jid"] },
  { canonical: "job_id", aliases: ["jobid", "job_id", "jid"] },
  {
    canonical: "requisition_id",
    aliases: ["requisitionid", "requisition_id", "reqid", "req_id"],
  },
  { canonical: "posting_id", aliases: ["postingid", "posting_id"] },
] as const;

function normalizePathname(pathname: string) {
  let out = pathname || "/";
  if (out !== "/") out = out.replace(/\/+$/, "") || "/";
  return out;
}

function getLinkedInJobId(url: URL): string {
  const fromPath = LINKEDIN_VIEW_RE.exec(url.pathname)?.[1];
  if (fromPath) return fromPath;

  // Many LinkedIn URLs carry the job id in query params (e.g. /jobs/search/?currentJobId=123)
  const fromQuery =
    url.searchParams.get("currentJobId") ??
    url.searchParams.get("currentjobid") ??
    url.searchParams.get("jobId") ??
    url.searchParams.get("jobid");
  if (fromQuery && /^\d+$/.test(fromQuery)) return fromQuery;

  return "";
}

function encodeRfc3986Component(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function getStableQueryIdentity(url: URL): string {
  const entries = Array.from(url.searchParams.entries());
  for (const group of IDENTITY_QUERY_GROUPS) {
    for (const alias of group.aliases) {
      const entry = entries.find(([key]) => key.toLowerCase() === alias);
      if (!entry) continue;
      const rawValue = entry[1];
      const value = rawValue.trim();
      if (!value || value.length > 200) continue;
      return `${group.canonical}=${encodeRfc3986Component(value)}`;
    }
  }
  return "";
}

/**
 * The href to actually open a stored job URL with. The canonical form strips
 * `www.` because it is a dedupe key, but LinkedIn's edge serves a hard 403 to
 * real browsers on the bare host in some regions, so outbound links restore
 * it. Everything else passes through unchanged.
 */
export function externalJobUrl(jobUrl: string): string {
  try {
    const parsed = new URL(jobUrl);
    if (parsed.hostname.toLowerCase() === "linkedin.com") {
      parsed.hostname = "www.linkedin.com";
      return parsed.toString();
    }
  } catch {
    // Not a parseable URL; the caller renders what it stored.
  }
  return jobUrl;
}

export function canonicalizeJobUrl(raw: string) {
  const input = raw.trim();
  if (!input) return "";

  try {
    const parsed = new URL(input);

    const protocol = parsed.protocol.toLowerCase();
    if (protocol !== "http:" && protocol !== "https:") return "";
    const hostnameLower = parsed.hostname.toLowerCase();
    if (!hostnameLower) return "";

    // Normalize www + LinkedIn subdomains (e.g. au.linkedin.com -> linkedin.com)
    let hostname = hostnameLower.replace(/^www\./, "");
    if (hostname === "linkedin.com" || hostname.endsWith(".linkedin.com")) {
      hostname = "linkedin.com";
    }

    const isDefaultPort =
      (protocol === "https:" && parsed.port === "443") ||
      (protocol === "http:" && parsed.port === "80");
    const host = parsed.port && !isDefaultPort ? `${hostname}:${parsed.port}` : hostname;

    if (hostname === "linkedin.com") {
      const jobId = getLinkedInJobId(parsed);
      if (jobId) {
        // Force to a stable job posting URL.
        return `https://linkedin.com/jobs/view/${jobId}`;
      }
    }

    const pathname = normalizePathname(parsed.pathname);
    const stableIdentity = getStableQueryIdentity(parsed);
    return `${protocol}//${host}${pathname}${
      stableIdentity ? `?${stableIdentity}` : ""
    }`;
  } catch {
    return "";
  }
}
