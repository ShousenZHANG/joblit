import type { RawCnJob } from "../types";

// Nowcoder (牛客) field extractor. Nowcoder reaches us through the RSSHub
// `/nowcoder/jobcenter` route, whose RSS items use the title format
// "Company | Job Title" and stuff the rest (city, salary) into the
// description HTML. The generic RSS parser leaves company/location null, so
// this enriches those rows: company is split out of the title and the city is
// best-effort matched from the description. Pure functions — unit tested.

// Cities Nowcoder's job center filters by, plus a few common extras. Order
// matters only for the first-match scan; all are distinct city names.
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

/** Nowcoder RSSHub title is "Company | Job Title" (full- or half-width bar).
 *  Split into the two; falls back to the whole string as the title. */
export function parseNowcoderTitle(rawTitle: string): {
  company: string | null;
  title: string;
} {
  const raw = (rawTitle ?? "").trim();
  const barIdx = (() => {
    const half = raw.indexOf("|");
    const full = raw.indexOf("｜");
    if (half === -1) return full;
    if (full === -1) return half;
    return Math.min(half, full);
  })();
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

/**
 * Refine a raw Nowcoder RSS row: pull the company out of the title and a city
 * out of the description. No-op for non-Nowcoder rows so it is safe to apply
 * to every RSSHub item indiscriminately.
 */
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
