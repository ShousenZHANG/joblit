import type { AdapterResult, RawCnJob } from "../types";
import { safeOutboundFetch } from "@/lib/server/net/safeFetch";

// Nowcoder (牛客) is the single CN job source. Its job board (牛客优聘) is a
// client-rendered SPA, but Nowcoder server-renders the full listing for crawler
// User-Agents (for SEO) and embeds the data as a `window.__INITIAL_STATE__`
// JSON blob. We fetch the 社招广场 + 实习广场 pages directly with an honest bot
// UA (Nowcoder serves SSR to any `compatible; *Bot` UA — no Googlebot spoofing)
// and parse that JSON. No RSSHub, no auth, no headless browser. Public,
// non-personal listing data.

const CENTERS = [
  "https://www.nowcoder.com/jobs/fulltime/center", // 社招广场
  "https://www.nowcoder.com/jobs/intern/center", // 实习广场
];
const UA = "Mozilla/5.0 (compatible; JoblitBot/1.0; +https://www.joblit.tech)";
const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const NOWCODER_HOST = "www.nowcoder.com";
const STATE_MARKER = "__INITIAL_STATE__=";

interface NcJobData {
  id?: number;
  jobName?: string;
  jobCity?: string;
  jobCityList?: string[];
  companyId?: number;
  ext?: string;
  recruitType?: number;
}

/** Pull the `window.__INITIAL_STATE__={...}` object out of the SSR HTML via a
 *  string-aware brace match (regex can't balance nested braces safely). */
export function extractInitialState(html: string): unknown | null {
  const at = html.indexOf(STATE_MARKER);
  if (at === -1) return null;
  const start = html.indexOf("{", at);
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Recursively collect job rows — any object with a `data.id` + `data.jobName`. */
export function collectJobItems(state: unknown): NcJobData[] {
  const out: NcJobData[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const x of node) walk(x);
      return;
    }
    const rec = node as Record<string, unknown>;
    const data = rec.data as Record<string, unknown> | undefined;
    if (
      data &&
      typeof data === "object" &&
      (typeof data.id === "number" || typeof data.id === "string") &&
      typeof data.jobName === "string"
    ) {
      out.push(data as NcJobData);
    }
    for (const key of Object.keys(rec)) walk(rec[key]);
  };
  walk(state);
  return out;
}

/** Recursively build a companyId -> companyName map from the state tree. */
export function collectCompanyNames(state: unknown): Map<number, string> {
  const map = new Map<number, string>();
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const x of node) walk(x);
      return;
    }
    const rec = node as Record<string, unknown>;
    const id = rec.companyId;
    const name = rec.companyName;
    if (typeof id === "number" && typeof name === "string" && name.trim() && !map.has(id)) {
      map.set(id, name.trim());
    }
    for (const key of Object.keys(rec)) walk(rec[key]);
  };
  walk(state);
  return map;
}

function parseExtDescription(ext?: string): string | null {
  if (!ext) return null;
  try {
    const obj = JSON.parse(ext) as { infos?: string; requirements?: string };
    const text = [obj.infos, obj.requirements].filter(Boolean).join("\n\n").trim();
    return text ? text.slice(0, 4000) : null;
  } catch {
    return null;
  }
}

export function mapNowcoderJob(
  data: NcJobData,
  companies: Map<number, string>,
): RawCnJob | null {
  if (data.id == null || !data.jobName) return null;
  const location = data.jobCity?.trim()
    ? data.jobCity.split(/[，,]/).map((c) => c.trim()).filter(Boolean).join(" · ")
    : data.jobCityList?.length
      ? data.jobCityList.join(" · ")
      : null;
  return {
    jobUrl: `https://www.nowcoder.com/jobs/detail/${data.id}`,
    title: data.jobName.trim(),
    company: (data.companyId != null && companies.get(data.companyId)) || null,
    location,
    jobType: data.recruitType === 1 ? "internship" : null,
    jobLevel: null,
    description: parseExtDescription(data.ext),
    publishedAt: null,
    source: "nowcoder",
  };
}

/** Parse one SSR center page into deduped job rows. Pure + tested. */
export function parseNowcoderHtml(html: string): RawCnJob[] {
  const state = extractInitialState(html);
  if (!state) return [];
  const companies = collectCompanyNames(state);
  const seen = new Set<string>();
  const out: RawCnJob[] = [];
  for (const item of collectJobItems(state)) {
    const job = mapNowcoderJob(item, companies);
    if (!job || seen.has(job.jobUrl)) continue;
    seen.add(job.jobUrl);
    out.push(job);
  }
  return out;
}

interface NowcoderAdapterOptions {
  fetchImpl?: typeof fetch;
  centers?: string[];
  timeoutMs?: number;
}

/** Fetch + parse Nowcoder's 社招/实习 job centers directly (no RSSHub). */
export async function fetchNowcoderJobs(
  options: NowcoderAdapterOptions = {},
): Promise<AdapterResult> {
  const centers = options.centers ?? CENTERS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const all: RawCnJob[] = [];
  const errors: string[] = [];
  for (const url of centers) {
    try {
      const init: RequestInit = {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
      };
      const res = options.fetchImpl
        ? await options.fetchImpl(url, init)
        : await safeOutboundFetch(url, init, {
            allowedHosts: [NOWCODER_HOST],
            allowSubdomains: false,
            maxRedirects: 0,
            maxResponseBytes: MAX_RESPONSE_BYTES,
            timeoutMs,
          });
      if (!res.ok) {
        errors.push(`${res.status}`);
        continue;
      }
      all.push(...parseNowcoderHtml(await res.text()));
    } catch (err) {
      errors.push(err instanceof Error ? err.message : "error");
    }
  }

  const seen = new Set<string>();
  const unique = all.filter((j) => {
    if (seen.has(j.jobUrl)) return false;
    seen.add(j.jobUrl);
    return true;
  });

  return {
    source: "nowcoder",
    ok: errors.length < centers.length || unique.length > 0,
    jobs: unique,
    error: errors.length ? errors.join(",") : undefined,
  };
}
