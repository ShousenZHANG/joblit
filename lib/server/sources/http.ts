import type { SourceContext } from "./types";
import { safeOutboundFetch } from "@/lib/server/net/safeFetch";

// One gateway for every outbound request the source layer makes. Adapters get
// no other network access, so these guarantees hold for all of them:
//   - https only
//   - hostname pinned to an explicit per-adapter allowlist
//   - redirect:"error" — a server-side redirect cannot escape the allowlist
//   - bounded timeout so one hung feed cannot stall a fetch run
//
// These are third-party hosts whose responses we then persist, so the pinning
// is the difference between reading a job board and following it anywhere it
// points.

const DEFAULT_TIMEOUT_MS = 12_000;
const USER_AGENT =
  "Mozilla/5.0 (compatible; JoblitBot/1.0; +https://www.joblit.tech)";

/**
 * Throw unless `url` is an https URL whose hostname is, or is a subdomain of,
 * an allowlist entry. Suffix matching is anchored on a dot so
 * "evil-remoteok.com" cannot satisfy a "remoteok.com" allowlist.
 */
export function assertAllowedUrl(
  url: string,
  allowedHosts: readonly string[],
): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`source fetch: invalid URL: ${url}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`source fetch: URL must use https: ${url}`);
  }
  const hostname = parsed.hostname.toLowerCase();
  const allowed = allowedHosts.some((raw) => {
    const host = raw.toLowerCase();
    return hostname === host || hostname.endsWith(`.${host}`);
  });
  if (!allowed) {
    throw new Error(`source fetch: untrusted host "${hostname}"`);
  }
  return parsed;
}

export async function fetchSourceJson(
  url: string,
  allowedHosts: readonly string[],
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<unknown> {
  assertAllowedUrl(url, allowedHosts);
  const res = await safeOutboundFetch(
    url,
    {
      method: "GET",
      headers: { "user-agent": USER_AGENT, accept: "application/json" },
    },
    {
      allowedHosts,
      allowSubdomains: true,
      maxRedirects: 0,
      maxResponseBytes: 4 * 1024 * 1024,
      timeoutMs,
    },
  );
  if (!res.ok) {
    throw new Error(`source fetch: HTTP ${res.status} for ${url}`);
  }
  return await res.json();
}

/** The real context handed to adapters in production. */
export function makeSourceContext(): SourceContext {
  return {
    fetchJson: (url, allowedHosts) => fetchSourceJson(url, allowedHosts),
  };
}
