import type { AdapterResult, RawCnJob } from "../types";

// V2EX 酷工作 public JSON API. No auth, no quota, dev-focused.
// Docs: https://www.v2ex.com/help/api
//
// Response shape (abbreviated):
//   [{
//     id: number,
//     title: string,
//     url: string,
//     content: string,
//     created: number,            // unix seconds
//     node: { name: string, title: string },
//     member: { username: string }
//   }, ...]

const DEFAULT_ENDPOINT = "https://www.v2ex.com/api/topics/show.json?node_name=jobs";
const DEFAULT_TIMEOUT_MS = 8000;

interface V2exTopic {
  id?: number;
  title?: string;
  url?: string;
  content?: string;
  created?: number;
  member?: { username?: string };
}

interface V2exAdapterOptions {
  /** Override fetch (test seam). */
  fetchImpl?: typeof fetch;
  /** Override endpoint (test seam). */
  endpoint?: string;
  /** Request timeout ms. */
  timeoutMs?: number;
}

/**
 * Best-effort parse of V2EX recruitment titles:
 *   "[Company][Role][City] ..."  → company, role tokens extracted
 *   "【字节跳动招聘】前端工程师·上海" → Chinese bracket variant
 * Falls back to the whole title as-is.
 */
export function parseV2exTitle(raw: string): {
  title: string;
  company: string | null;
  location: string | null;
} {
  if (!raw) return { title: "", company: null, location: null };

  // Match [...] and 【...】 bracket groups.
  const re = /[[【]([^\]】]+)[\]】]/g;
  const brackets: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const inner = m[1].trim();
    if (inner) brackets.push(inner);
  }

  // Residual = title text with bracket groups stripped out.
  const residual = raw.replace(re, "").trim();

  let company: string | null = null;
  let location: string | null = null;
  let title = residual || raw;

  if (brackets.length >= 3) {
    // "[Company][Role][City]" — role lives in the middle bracket(s).
    company = brackets[0];
    location = brackets[brackets.length - 1];
    if (!residual) {
      title = brackets.slice(1, -1).join(" ").trim() || raw;
    }
  } else if (brackets.length === 2) {
    company = brackets[0];
    location = brackets[1];
  } else if (brackets.length === 1) {
    company = brackets[0];
  }

  return { title, company, location };
}

/**
 * Fetch latest V2EX recruitment topics. Returns AdapterResult which always
 * resolves (never rejects) so the orchestrator can keep running even when
 * this single source is down.
 */
export async function fetchV2exJobs(
  options: V2exAdapterOptions = {},
): Promise<AdapterResult> {
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const doFetch = options.fetchImpl ?? fetch;

  try {
    const res = await doFetch(endpoint, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: "application/json", "User-Agent": "Joblit/1.0 (+cn-fetch)" },
    });
    if (!res.ok) {
      return {
        source: "v2ex",
        ok: false,
        jobs: [],
        error: `v2ex_${res.status}`,
      };
    }
    const body = (await res.json().catch(() => [])) as V2exTopic[];
    if (!Array.isArray(body)) {
      return { source: "v2ex", ok: false, jobs: [], error: "v2ex_bad_shape" };
    }

    const jobs: RawCnJob[] = body
      .filter((t) => typeof t.url === "string" && typeof t.title === "string")
      .map((t) => {
        const parsed = parseV2exTitle(t.title ?? "");
        return {
          jobUrl: t.url as string,
          title: parsed.title,
          company: parsed.company ?? t.member?.username ?? null,
          location: parsed.location,
          jobType: null,
          jobLevel: null,
          description: (t.content ?? "").slice(0, 4000) || null,
          publishedAt:
            typeof t.created === "number"
              ? new Date(t.created * 1000).toISOString()
              : null,
          source: "v2ex",
        };
      });

    return { source: "v2ex", ok: true, jobs };
  } catch (err) {
    return {
      source: "v2ex",
      ok: false,
      jobs: [],
      error: err instanceof Error ? err.message : "v2ex_error",
    };
  }
}
