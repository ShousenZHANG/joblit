import type {
  AtsBoardConfig,
  AtsProvider,
  LeverRegion,
} from "./atsBoards";

export interface DiscoveredAtsBoard {
  provider: AtsProvider;
  boardToken: string;
  region?: LeverRegion;
  sourceUrl: string;
}

export type AtsRediscoveryStatus =
  | "not_applicable"
  | "unchanged"
  | "rediscovered"
  | "not_found";

export interface AtsRediscoveryResult {
  status: AtsRediscoveryStatus;
  config: AtsBoardConfig;
  attempted: DiscoveredAtsBoard[];
}

const ATS_HOSTS = new Set([
  "boards.greenhouse.io",
  "job-boards.greenhouse.io",
  "boards-api.greenhouse.io",
  "jobs.lever.co",
  "jobs.eu.lever.co",
  "api.lever.co",
  "api.eu.lever.co",
  "jobs.ashbyhq.com",
  "api.ashbyhq.com",
  "apply.workable.com",
  "www.workable.com",
]);

function safeToken(value: string | undefined): string | null {
  if (!value) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(decoded)
    ? decoded
    : null;
}

/** Parse a public ATS careers/API URL into a tenant candidate. */
export function parseAtsBoardUrl(value: string): DiscoveredAtsBoard | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !ATS_HOSTS.has(url.hostname.toLowerCase())
  ) {
    return null;
  }

  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);
  let provider: AtsProvider;
  let token: string | null;
  let region: LeverRegion | undefined;

  if (host.endsWith("greenhouse.io")) {
    provider = "greenhouse";
    const boardIndex = segments.indexOf("boards");
    token = safeToken(
      boardIndex >= 0 ? segments[boardIndex + 1] : segments[0],
    );
  } else if (host.endsWith("lever.co")) {
    provider = "lever";
    region = host.includes(".eu.") || host.startsWith("jobs.eu.") ? "eu" : "global";
    const postingsIndex = segments.indexOf("postings");
    token = safeToken(
      postingsIndex >= 0 ? segments[postingsIndex + 1] : segments[0],
    );
  } else if (host.endsWith("ashbyhq.com")) {
    provider = "ashby";
    const boardIndex = segments.indexOf("job-board");
    token = safeToken(
      boardIndex >= 0 ? segments[boardIndex + 1] : segments[0],
    );
  } else {
    provider = "workable";
    const accountsIndex = segments.indexOf("accounts");
    token = safeToken(
      accountsIndex >= 0 ? segments[accountsIndex + 1] : segments[0],
    );
    // apply.workable.com/j/{job-code} is an individual posting, not a tenant.
    if (host === "apply.workable.com" && segments[0]?.toLowerCase() === "j") {
      return null;
    }
  }

  if (!token) return null;
  return {
    provider,
    boardToken: token,
    ...(region ? { region } : {}),
    sourceUrl: url.href,
  };
}

/**
 * Pull trusted ATS links from already-fetched company careers HTML. This does
 * not fetch the page itself; callers must use the project's guarded outbound
 * gateway. Keeping discovery parsing pure makes 404 recovery deterministic.
 */
export function discoverAtsBoardsFromHtml(
  html: string,
  baseUrl: string,
): DiscoveredAtsBoard[] {
  if (html.length > 2_000_000) return [];
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }
  if (base.protocol !== "https:") return [];

  const values: string[] = [];
  const hrefPattern = /\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi;
  for (const match of html.matchAll(hrefPattern)) {
    const raw = match[1] ?? match[2] ?? match[3];
    if (!raw) continue;
    try {
      values.push(new URL(raw.replace(/&amp;/gi, "&"), base).href);
    } catch {
      // Ignore malformed page-owned links.
    }
  }

  const seen = new Set<string>();
  const candidates: DiscoveredAtsBoard[] = [];
  for (const value of values) {
    const candidate = parseAtsBoardUrl(value);
    if (!candidate) continue;
    const key = `${candidate.provider}:${candidate.region ?? ""}:${candidate.boardToken.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(candidate);
  }
  return candidates;
}

export interface RediscoverAtsBoardOptions {
  /** Recovery is intentionally limited to a confirmed 404/410 tenant loss. */
  failedStatus: number;
  current: AtsBoardConfig;
  candidates: readonly DiscoveredAtsBoard[];
  /** Probe through a guarded source request. True means board is reachable. */
  probe: (candidate: AtsBoardConfig) => Promise<boolean>;
  maxAttempts?: number;
}

/**
 * Probe same-provider tenant candidates after a board disappears. Source id
 * stays stable so persisted Job.source values and health history do not split.
 */
export async function rediscoverAtsBoardAfter404(
  options: RediscoverAtsBoardOptions,
): Promise<AtsRediscoveryResult> {
  if (options.failedStatus !== 404 && options.failedStatus !== 410) {
    return {
      status: "not_applicable",
      config: options.current,
      attempted: [],
    };
  }

  const maxAttempts = Math.max(0, Math.min(options.maxAttempts ?? 12, 25));
  const currentKey = `${options.current.region ?? ""}:${options.current.boardToken.toLowerCase()}`;
  const seen = new Set<string>([currentKey]);
  const attempted: DiscoveredAtsBoard[] = [];

  for (const candidate of options.candidates) {
    if (attempted.length >= maxAttempts) break;
    if (candidate.provider !== options.current.provider) continue;
    const key = `${candidate.region ?? ""}:${candidate.boardToken.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    attempted.push(candidate);

    const next: AtsBoardConfig = {
      ...options.current,
      boardToken: candidate.boardToken,
      ...(candidate.provider === "lever"
        ? { region: candidate.region ?? "global" }
        : {}),
    };
    try {
      if (await options.probe(next)) {
        return { status: "rediscovered", config: next, attempted };
      }
    } catch {
      // One stale candidate must not prevent probing remaining known links.
    }
  }

  return {
    status: attempted.length ? "not_found" : "unchanged",
    config: options.current,
    attempted,
  };
}
