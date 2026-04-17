import type { AdapterResult, RawCnJob } from "../types";

// GitHub-backed CN job aggregator. Pulls raw README.md from curated
// "awesome China IT jobs" style repositories and parses Markdown tables /
// bulleted lists into RawCnJob. Uses raw.githubusercontent.com so there's
// no API key, no rate limit, no auth.
//
// The canonical repo list below can be overridden via env var
// GITHUB_CN_JOB_REPOS (comma-separated "owner/repo" strings) if the user
// wants to point at their own curated list.

const DEFAULT_REPOS = [
  "xtuhcy/china-it-jobs",
  "xiaoymin/spring-boot-api-project-seed",
];
const DEFAULT_TIMEOUT_MS = 8000;

export interface GithubAdapterOptions {
  fetchImpl?: typeof fetch;
  repos?: string[];
  timeoutMs?: number;
}

interface ParsedMdRow {
  title: string | null;
  company: string | null;
  location: string | null;
  url: string | null;
}

/**
 * Extract the first bare URL from a markdown cell, handling both
 * `[label](url)` and raw `https://...` forms.
 */
function extractUrl(cell: string): string | null {
  const linkMatch = /\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/.exec(cell);
  if (linkMatch) return linkMatch[1];
  const raw = /(https?:\/\/[^\s)]+)/.exec(cell);
  return raw ? raw[1] : null;
}

function stripMd(cell: string): string {
  return cell
    .replace(/\[[^\]]*\]\([^)]*\)/g, (m) => {
      // Pull the label out of [label](url) for display.
      const label = /\[([^\]]*)\]/.exec(m);
      return label?.[1] ?? "";
    })
    .replace(/[*_`]/g, "")
    .trim();
}

/**
 * Parse a GitHub-flavoured Markdown body into RawCnJob rows. Supports two
 * layouts commonly used by awesome-jobs lists:
 *   1. Pipe table:  | Company | Role | City | Link |
 *   2. Bullet list: `- [Role at Company](url) — City`
 *
 * Non-matching lines are silently skipped.
 */
export function parseJobsMarkdown(md: string): RawCnJob[] {
  if (!md) return [];
  const rows: RawCnJob[] = [];

  // ── Pipe-table rows ────────────────────────────────────
  for (const line of md.split(/\r?\n/)) {
    if (!line.includes("|")) continue;
    const cells = line
      .split("|")
      .map((c) => c.trim())
      .filter((c, i, a) => !(i === 0 && c === "") && !(i === a.length - 1 && c === ""));
    if (cells.length < 3) continue;
    // Skip alignment rows ("---").
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
    // Header row detection — common header labels get skipped.
    const joined = cells.map((c) => c.toLowerCase()).join(" ");
    if (/\b(company|公司|岗位|role|title)\b.*(city|location|城市)/.test(joined)) {
      continue;
    }

    const url = cells.map(extractUrl).find(Boolean);
    if (!url) continue;
    const [first, second, third] = cells.map(stripMd);
    const title = second || first || null;
    const company = first && second ? first : null;
    const location = third || null;
    if (!title) continue;
    rows.push({
      jobUrl: url,
      title,
      company,
      location,
      jobType: null,
      jobLevel: null,
      description: null,
      publishedAt: null,
      source: "github",
    });
  }

  // ── Bullet list rows ────────────────────────────────────
  const bulletRe = /^\s*[-*]\s*\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)\s*[—–-]?\s*(.*)$/;
  for (const line of md.split(/\r?\n/)) {
    const m = bulletRe.exec(line);
    if (!m) continue;
    const label = m[1].trim();
    const url = m[2].trim();
    const trailing = m[3].trim();

    // Try "Role at Company" / "Role @ Company" split.
    let title = label;
    let company: string | null = null;
    const atMatch = /^(.+?)\s+(?:at|@)\s+(.+)$/i.exec(label);
    if (atMatch) {
      title = atMatch[1].trim();
      company = atMatch[2].trim();
    }
    rows.push({
      jobUrl: url,
      title,
      company,
      location: trailing || null,
      jobType: null,
      jobLevel: null,
      description: null,
      publishedAt: null,
      source: "github",
    });
  }

  // Dedup by URL within a single markdown parse.
  const seen = new Set<string>();
  return rows.filter((r) => {
    if (seen.has(r.jobUrl)) return false;
    seen.add(r.jobUrl);
    return true;
  });
}

async function fetchRepoReadme(
  slug: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<string | null> {
  // Try master first, then main. raw.githubusercontent.com has no rate limit
  // worth worrying about for small text pulls.
  for (const branch of ["master", "main"]) {
    const url = `https://raw.githubusercontent.com/${slug}/${branch}/README.md`;
    try {
      const res = await fetchImpl(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { Accept: "text/plain", "User-Agent": "Joblit/1.0 (+cn-fetch)" },
      });
      if (res.ok) return await res.text();
    } catch {
      // try next branch
    }
  }
  return null;
}

export async function fetchGithubJobs(
  options: GithubAdapterOptions = {},
): Promise<AdapterResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const repos =
    options.repos ??
    (process.env.GITHUB_CN_JOB_REPOS
      ? process.env.GITHUB_CN_JOB_REPOS.split(",").map((s) => s.trim()).filter(Boolean)
      : DEFAULT_REPOS);

  const allJobs: RawCnJob[] = [];
  const errors: string[] = [];
  for (const slug of repos) {
    const md = await fetchRepoReadme(slug, fetchImpl, timeoutMs);
    if (!md) {
      errors.push(`${slug}_404`);
      continue;
    }
    const parsed = parseJobsMarkdown(md);
    allJobs.push(...parsed);
  }

  // Dedup across repos (one URL may appear in multiple lists).
  const seen = new Set<string>();
  const unique = allJobs.filter((j) => {
    if (seen.has(j.jobUrl)) return false;
    seen.add(j.jobUrl);
    return true;
  });

  return {
    source: "github",
    ok: unique.length > 0 || errors.length < repos.length,
    jobs: unique,
    error: errors.length === repos.length ? errors.join(",") : undefined,
  };
}
