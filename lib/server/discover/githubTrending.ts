import type { TrendingRepo } from "@/app/(app)/discover/types";

// GitHub trending — quality-first ranking.
//
// Previous impl primarily used OSS Insight's activity-score API, which surfaces
// a lot of bursty / tutorial / predominantly-Chinese repos rather than genuinely
// popular software. This module sources directly from the GitHub Search API
// (authoritative star counts), raises the star floor, and applies a quality gate
// so the feed reads like a real "rising popular projects" leaderboard.

export type TrendingPeriod = "weekly" | "monthly";

// Star floor by period — a repo created this recently with this many stars is
// genuinely going viral, not just noise. Tuned higher than the old `>50`.
const STAR_FLOOR: Record<TrendingPeriod, number> = {
  weekly: 100,
  monthly: 500,
};

// Over-fetch so the quality gate still leaves a full page after dropping noise.
const FETCH_SIZE = 50;
const RESULT_SIZE = 20;

// Repos whose human-readable text is mostly CJK are filtered: the Discover feed
// targets an English-first audience and these dominate GitHub trending with
// tutorial / interview / awesome-list content rather than reusable software.
const CJK_RE = /[぀-ヿ㐀-䶿一-鿿豈-﫿ｦ-ﾟ]/g;
const CJK_RATIO_THRESHOLD = 0.2;

export function cjkRatio(text: string): number {
  const stripped = (text || "").replace(/\s/g, "");
  if (stripped.length === 0) return 0;
  const cjk = stripped.match(CJK_RE)?.length ?? 0;
  return cjk / stripped.length;
}

export function isMostlyCjk(text: string): boolean {
  return cjkRatio(text) >= CJK_RATIO_THRESHOLD;
}

// Low-signal repo archetypes that flood GitHub trending but aren't reusable
// software: awesome-lists, roadmaps, interview prep, free-book collections,
// cheatsheets, course/notes dumps. Matched on the repo's short name.
const LOW_SIGNAL_NAME_RE =
  /(^awesome[-_])|(-?roadmap)|(tutorials?)|(interview)|(cheat[-_]?sheets?)|(free-programming)|(-?books?$)|(coding-?challenge)|(study-?notes?)|(learn(ing)?-?notes?)|(教程|面试|学习|指南|笔记|资料|导航|手册)/i;

// Description phrases that mark a curated list / learning resource rather than
// a project.
const LOW_SIGNAL_DESC_RE =
  /(curated list)|(a list of)|(collection of (free|awesome|resources))|(awesome list)|(面试题)|(学习路线)/i;

export function isLowSignalRepo(fullName: string, description: string | null): boolean {
  const shortName = (fullName.split("/")[1] ?? fullName).toLowerCase();
  if (LOW_SIGNAL_NAME_RE.test(shortName)) return true;
  if (description && LOW_SIGNAL_DESC_RE.test(description)) return true;
  return false;
}

export interface RawRepoLike {
  fullName: string;
  description: string | null;
  stars: number;
  archived?: boolean;
}

/**
 * Quality gate. Keep only repos that look like genuinely popular, reusable
 * software: has a description, not archived, above the star floor, not a
 * mostly-CJK listing, and not a known low-signal archetype.
 */
export function passesQualityGate(repo: RawRepoLike, floor: number): boolean {
  if (!repo.description || repo.description.trim().length === 0) return false;
  if (repo.archived) return false;
  if (repo.stars < floor) return false;
  if (isMostlyCjk(`${repo.fullName} ${repo.description}`)) return false;
  if (isLowSignalRepo(repo.fullName, repo.description)) return false;
  return true;
}

/**
 * Rank + trim a fetched repo list: apply the quality gate, sort by stars desc,
 * take the top N. Pure function — unit tested independently of the network.
 */
export function rankRepos(
  repos: (TrendingRepo & { archived?: boolean })[],
  period: TrendingPeriod,
): TrendingRepo[] {
  const floor = STAR_FLOOR[period];
  return repos
    .filter((r) => passesQualityGate(r, floor))
    .sort((a, b) => b.stars - a.stars)
    .slice(0, RESULT_SIZE)
    .map(({ archived: _archived, ...rest }) => rest);
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}
function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
function asNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Fetch rising-popular repos from the GitHub Search API and rank them through
 * the quality gate. Authoritative star counts, raised floor, over-fetch then
 * trim. `created:>{since}` keeps the feed about NEW viral projects (the point
 * of a discovery feed) rather than the same all-time list every week.
 */
export async function fetchTrendingRepos(
  period: TrendingPeriod,
  token?: string,
): Promise<TrendingRepo[]> {
  const since = period === "weekly" ? daysAgo(7) : daysAgo(30);
  const floor = STAR_FLOOR[period];
  const url = new URL("https://api.github.com/search/repositories");
  url.searchParams.set("q", `created:>${since} stars:>${floor} archived:false`);
  url.searchParams.set("sort", "stars");
  url.searchParams.set("order", "desc");
  url.searchParams.set("per_page", String(FETCH_SIZE));

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "Joblit-Discover/1.0",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url.toString(), { headers, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${res.statusText}`);

  const json = (await res.json()) as unknown;
  const rawItems = asRecord(json).items;
  const items: unknown[] = Array.isArray(rawItems) ? rawItems : [];

  const mapped = items.map((raw): TrendingRepo & { archived: boolean } => {
    const item = asRecord(raw);
    const owner = asRecord(item.owner);
    const topics = Array.isArray(item.topics)
      ? (item.topics as unknown[]).filter((t): t is string => typeof t === "string")
      : [];
    return {
      id: asNumber(item.id),
      fullName: asString(item.full_name),
      description: asNullableString(item.description),
      url: asString(item.html_url),
      stars: asNumber(item.stargazers_count),
      forks: asNumber(item.forks_count),
      language: asNullableString(item.language),
      topics: topics.slice(0, 5),
      ownerAvatar: asString(owner.avatar_url),
      pushedAt: asString(item.pushed_at),
      archived: item.archived === true,
    };
  });

  return rankRepos(mapped, period);
}
