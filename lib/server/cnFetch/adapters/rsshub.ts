import type { AdapterResult, RawCnJob } from "../types";

// Optional RSSHub adapter. Enabled only when RSSHUB_URL env var is set
// (user-hosted instance — we don't run one ourselves). Consumes the
// generic job-board RSS routes and emits RawCnJob rows.
//
// RSSHUB_URL format: "https://rsshub.example.com"
// RSSHUB_JOB_ROUTES  optional override for which routes to hit,
//                    comma-separated path-only values like "/boss/foo,/liepin/..."
// Defaults to a small curated set of recruitment routes.

const DEFAULT_ROUTES = ["/liepin/campus"];
const DEFAULT_TIMEOUT_MS = 10_000;

export interface RsshubAdapterOptions {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  routes?: string[];
  timeoutMs?: number;
}

/**
 * Minimal RSS 2.0 parser — good enough for RSSHub output which is highly
 * regular. Avoids pulling a full XML dependency; we only need title,
 * link, description, pubDate.
 */
export function parseRssItems(xml: string): RawCnJob[] {
  if (!xml) return [];
  const items: RawCnJob[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let match: RegExpExecArray | null;
  while ((match = itemRe.exec(xml)) !== null) {
    const body = match[1];
    const title = extractTag(body, "title");
    const link = extractTag(body, "link");
    const description = extractTag(body, "description");
    const pubDate = extractTag(body, "pubDate");
    if (!title || !link) continue;
    items.push({
      jobUrl: link,
      title,
      company: null,
      location: null,
      jobType: null,
      jobLevel: null,
      description: description ? description.slice(0, 4000) : null,
      publishedAt: pubDate ? safeIso(pubDate) : null,
      source: "rsshub",
    });
  }
  return items;
}

function extractTag(body: string, tag: string): string | null {
  // CDATA-wrapped first, then plain.
  const cdata = new RegExp(`<${tag}><!\\[CDATA\\[(.*?)]]></${tag}>`, "s").exec(body);
  if (cdata) return cdata[1].trim();
  const plain = new RegExp(`<${tag}>(.*?)</${tag}>`, "s").exec(body);
  return plain ? plain[1].trim() : null;
}

function safeIso(raw: string): string | null {
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export async function fetchRsshubJobs(
  options: RsshubAdapterOptions = {},
): Promise<AdapterResult> {
  const baseUrl = options.baseUrl ?? process.env.RSSHUB_URL;
  if (!baseUrl) {
    return { source: "rsshub", ok: true, jobs: [] }; // Silent no-op when disabled.
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const routes =
    options.routes ??
    (process.env.RSSHUB_JOB_ROUTES
      ? process.env.RSSHUB_JOB_ROUTES.split(",").map((s) => s.trim()).filter(Boolean)
      : DEFAULT_ROUTES);

  const all: RawCnJob[] = [];
  const errors: string[] = [];
  for (const route of routes) {
    const url = `${baseUrl.replace(/\/$/, "")}${route.startsWith("/") ? route : `/${route}`}`;
    try {
      const res = await fetchImpl(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { Accept: "application/rss+xml,text/xml", "User-Agent": "Joblit/1.0 (+cn-fetch)" },
      });
      if (!res.ok) {
        errors.push(`${route}_${res.status}`);
        continue;
      }
      const xml = await res.text();
      all.push(...parseRssItems(xml));
    } catch (err) {
      errors.push(`${route}_${err instanceof Error ? err.message : "error"}`);
    }
  }

  const seen = new Set<string>();
  const unique = all.filter((j) => {
    if (seen.has(j.jobUrl)) return false;
    seen.add(j.jobUrl);
    return true;
  });

  return {
    source: "rsshub",
    ok: errors.length < routes.length || unique.length > 0,
    jobs: unique,
    error: errors.length ? errors.join(",") : undefined,
  };
}
