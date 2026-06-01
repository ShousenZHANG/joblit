import type { AdapterResult, RawCnJob } from "../types";

// Nowcoder (牛客) is the single CN job source. Nowcoder has no public API, so we
// read its public job board through a user-hosted RSSHub instance (RSSHUB_URL)
// via the /nowcoder/jobcenter routes — 社招广场 (recruitType 2) + 实习广场 (1) —
// then parse each RSS row and enrich it: the company is split out of the
// "Company | Title" title and the city is best-effort matched from the
// description. All pure helpers are unit tested.

const NOWCODER_ROUTES = ["/nowcoder/jobcenter/2", "/nowcoder/jobcenter/1"];
const DEFAULT_TIMEOUT_MS = 10_000;

// Cities Nowcoder's job center filters by, plus common extras.
const CN_CITIES = [
  "北京", "上海", "广州", "深圳", "杭州", "南京", "成都", "厦门", "武汉",
  "西安", "长沙", "哈尔滨", "合肥", "苏州", "天津", "重庆", "青岛", "大连",
  "郑州", "无锡", "宁波", "佛山", "东莞", "珠海", "济南", "福州", "昆明",
  "沈阳", "长春", "石家庄", "南昌", "贵阳", "兰州", "太原",
];

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

export function isNowcoderUrl(url: string): boolean {
  return /(^|\.)nowcoder\.com$/i.test(safeHost(url));
}

/** Nowcoder RSSHub title is "Company | Job Title" (full- or half-width bar). */
export function parseNowcoderTitle(rawTitle: string): {
  company: string | null;
  title: string;
} {
  const raw = (rawTitle ?? "").trim();
  const half = raw.indexOf("|");
  const full = raw.indexOf("｜");
  const barIdx = half === -1 ? full : full === -1 ? half : Math.min(half, full);
  if (barIdx > 0) {
    const company = raw.slice(0, barIdx).trim();
    const title = raw.slice(barIdx + 1).trim();
    if (company && title) return { company, title };
  }
  return { company: null, title: raw };
}

/** Best-effort city extraction from the (HTML) description text. */
export function extractCnCity(text: string | null): string | null {
  if (!text) return null;
  const plain = text.replace(/<[^>]*>/g, " ");
  for (const city of CN_CITIES) {
    if (plain.includes(city)) return city;
  }
  return null;
}

/** Refine a raw Nowcoder RSS row: company from title, city from description. */
export function enrichNowcoderJob(job: RawCnJob): RawCnJob {
  if (!isNowcoderUrl(job.jobUrl)) return job;
  const { company, title } = parseNowcoderTitle(job.title);
  return {
    ...job,
    title,
    company: job.company ?? company,
    location: job.location ?? extractCnCity(job.description),
  };
}

function extractTag(body: string, tag: string): string | null {
  const cdata = new RegExp(`<${tag}><!\\[CDATA\\[(.*?)]]></${tag}>`, "s").exec(body);
  if (cdata) return cdata[1].trim();
  const plain = new RegExp(`<${tag}>(.*?)</${tag}>`, "s").exec(body);
  return plain ? plain[1].trim() : null;
}

function safeIso(raw: string): string | null {
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Minimal RSS 2.0 parser for RSSHub's Nowcoder output; each item is enriched
 *  into structured company/location. */
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
    items.push(
      enrichNowcoderJob({
        jobUrl: link,
        title,
        company: null,
        location: null,
        jobType: null,
        jobLevel: null,
        description: description ? description.slice(0, 4000) : null,
        publishedAt: pubDate ? safeIso(pubDate) : null,
        source: "nowcoder",
      }),
    );
  }
  return items;
}

export interface NowcoderAdapterOptions {
  fetchImpl?: typeof fetch;
  /** RSSHub base, defaults to RSSHUB_URL. No-op when unset. */
  baseUrl?: string;
  routes?: string[];
  timeoutMs?: number;
}

/**
 * Fetch Nowcoder jobs via the configured RSSHub instance. Returns an empty
 * (ok) result when RSSHUB_URL is not set — Nowcoder requires self-hosted RSSHub.
 */
export async function fetchNowcoderJobs(
  options: NowcoderAdapterOptions = {},
): Promise<AdapterResult> {
  const baseUrl = options.baseUrl ?? process.env.RSSHUB_URL;
  if (!baseUrl) {
    return { source: "nowcoder", ok: true, jobs: [] }; // Silent no-op when RSSHub not configured.
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const routes = options.routes ?? NOWCODER_ROUTES;

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
      all.push(...parseRssItems(await res.text()));
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
    source: "nowcoder",
    ok: errors.length < routes.length || unique.length > 0,
    jobs: unique,
    error: errors.length ? errors.join(",") : undefined,
  };
}
