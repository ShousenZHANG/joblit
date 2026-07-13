import type { TrendingRepo } from "@/app/(app)/discover/types";

// GitHub trending — EXACT parity with github.com/trending.
//
// GitHub's trending board ranks established repos by *stars gained in the
// period* (a proprietary signal) and exposes NO public API. The previous
// implementation approximated it with the Search API (`created:>{since}` sorted
// by absolute stars), which surfaces brand-new repos by total star count — a
// completely different list from the official board. The only way to match
// github.com/trending is to read the same page it renders. This module fetches
// that HTML and parses the repo rows, so the feed is identical to the official
// "This week / This month" leaderboard.

export type TrendingPeriod = "weekly" | "monthly";

const PERIOD_TO_SINCE: Record<TrendingPeriod, string> = {
  weekly: "weekly",
  monthly: "monthly",
};

// github.com/trending renders 25 rows; the UI surfaces the top 20.
const RESULT_SIZE = 20;

const ENTITY_MAP: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&#x27;": "'",
  "&nbsp;": " ",
};

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&[a-z]+;|&#x?\w+;/gi, (m) => ENTITY_MAP[m] ?? m);
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

function clean(html: string): string {
  return decodeEntities(stripTags(html)).replace(/\s+/g, " ").trim();
}

function parseIntComma(text: string): number {
  const digits = text.replace(/[^\d]/g, "");
  return digits ? Number(digits) : 0;
}

/** Stable positive integer id from a repo's full name (the scraped page has no
 *  numeric id, but the TrendingRepo contract + React keys want one). */
function hashId(fullName: string): number {
  let h = 0;
  for (let i = 0; i < fullName.length; i++) {
    h = (h * 31 + fullName.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * Parse the github.com/trending HTML into the same repo list, in the same
 * order, the official page shows. Pure function — unit tested against a fixture
 * independently of the network.
 */
export function parseTrendingHtml(html: string): TrendingRepo[] {
  const blocks = html.split('<article class="Box-row">').slice(1);
  const repos: TrendingRepo[] = [];

  for (const block of blocks) {
    // Repo full name from the heading anchor: href="/owner/repo".
    const nameMatch = block.match(
      /<h2[^>]*lh-condensed[^>]*>[\s\S]*?href="\/([^"?#]+)"/,
    );
    if (!nameMatch) continue;
    const fullName = nameMatch[1].replace(/\/$/, "").trim();
    if (!fullName.includes("/")) continue;
    const owner = fullName.split("/")[0];

    const descMatch = block.match(/<p[^>]*col-9[^>]*>([\s\S]*?)<\/p>/);
    const description = descMatch ? clean(descMatch[1]) || null : null;

    const langMatch = block.match(/itemprop="programmingLanguage"[^>]*>([\s\S]*?)<\/span>/);
    const language = langMatch ? clean(langMatch[1]) || null : null;

    const starsMatch = block.match(/\/stargazers"[^>]*>([\s\S]*?)<\/a>/);
    const stars = starsMatch ? parseIntComma(clean(starsMatch[1])) : 0;

    const forksMatch = block.match(/\/forks"[^>]*>([\s\S]*?)<\/a>/);
    const forks = forksMatch ? parseIntComma(clean(forksMatch[1])) : 0;

    // "1,234 stars today / this week / this month" — the period delta.
    const gainedMatch = block.match(/([\d,]+)\s+stars?\s+(?:today|this week|this month)/i);
    const starsGained = gainedMatch ? parseIntComma(gainedMatch[1]) : 0;

    repos.push({
      id: hashId(fullName),
      fullName,
      description,
      url: `https://github.com/${fullName}`,
      stars,
      forks,
      starsGained,
      language,
      topics: [],
      ownerAvatar: `https://github.com/${owner}.png?size=48`,
      pushedAt: "",
    });

    if (repos.length >= RESULT_SIZE) break;
  }

  return repos;
}

// ── Optional noise filter ───────────────────────────────────────────────
// Off by default (the feed is official-parity). When enabled it drops the
// archetypes that flood the official board but aren't reusable software:
// predominantly-CJK listings, awesome-lists / roadmaps / interview-prep, and
// description-less rows. The result is still an official-order subset.

const CJK_RE = /[぀-ヿ㐀-䶿一-鿿豈-﫿ｦ-ﾟ]/g;
const CJK_RATIO_THRESHOLD = 0.2;

function cjkRatio(text: string): number {
  const stripped = (text || "").replace(/\s/g, "");
  if (stripped.length === 0) return 0;
  const cjk = stripped.match(CJK_RE)?.length ?? 0;
  return cjk / stripped.length;
}

export function isMostlyCjk(text: string): boolean {
  return cjkRatio(text) >= CJK_RATIO_THRESHOLD;
}

const LOW_SIGNAL_NAME_RE =
  /(^awesome[-_])|(-?roadmap)|(tutorials?)|(interview)|(cheat[-_]?sheets?)|(free-programming)|(-?books?$)|(coding-?challenge)|(study-?notes?)|(learn(ing)?-?notes?)|(教程|面试|学习|指南|笔记|资料|导航|手册)/i;

const LOW_SIGNAL_DESC_RE =
  /(curated list)|(a list of)|(collection of (free|awesome|resources))|(awesome list)|(面试题)|(学习路线)/i;

export function isLowSignalRepo(fullName: string, description: string | null): boolean {
  const shortName = (fullName.split("/")[1] ?? fullName).toLowerCase();
  if (LOW_SIGNAL_NAME_RE.test(shortName)) return true;
  if (description && LOW_SIGNAL_DESC_RE.test(description)) return true;
  return false;
}

/** Drop low-signal / mostly-CJK / description-less rows. Pure + tested. */
export function filterTrendingNoise(repos: TrendingRepo[]): TrendingRepo[] {
  return repos.filter((r) => {
    if (!r.description || r.description.trim().length === 0) return false;
    if (isMostlyCjk(`${r.fullName} ${r.description}`)) return false;
    if (isLowSignalRepo(r.fullName, r.description)) return false;
    return true;
  });
}

/**
 * Fetch github.com/trending for the given period and parse it. No auth needed
 * (public HTML). `_token` is accepted for call-site compatibility but unused.
 */
export async function fetchTrendingRepos(
  period: TrendingPeriod,
  _token?: string,
): Promise<TrendingRepo[]> {
  const since = PERIOD_TO_SINCE[period];
  const url = `https://github.com/trending?since=${since}`;

  const res = await fetch(url, {
    headers: {
      // A browser-like UA — GitHub serves the standard trending markup to it.
      "User-Agent":
        "Mozilla/5.0 (compatible; Joblit-Discover/1.0; +https://www.joblit.tech)",
      Accept: "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error(`GitHub trending ${res.status}: ${res.statusText}`);
  }

  const html = await res.text();
  return parseTrendingHtml(html);
}
