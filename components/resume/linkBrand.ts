/**
 * Link recognition for the resume's URL rows.
 *
 * Typing a LinkedIn URL and then hand-typing the word "LinkedIn" into the
 * label beside it is data entry the app can do itself. These helpers detect
 * the host and both suggest a label and pick the mark to show.
 *
 * Host matching is exact-or-subdomain, never a substring: `github.com.evil.io`
 * must not read as GitHub.
 */

export type LinkBrand =
  | "linkedin"
  | "github"
  | "gitlab"
  | "x"
  | "stackoverflow"
  | "medium"
  | "behance"
  | "dribbble"
  | "youtube"
  | "generic";

const BRAND_HOSTS: ReadonlyArray<{ brand: LinkBrand; label: string; hosts: string[] }> = [
  { brand: "linkedin", label: "LinkedIn", hosts: ["linkedin.com"] },
  { brand: "github", label: "GitHub", hosts: ["github.com", "github.io"] },
  { brand: "gitlab", label: "GitLab", hosts: ["gitlab.com"] },
  { brand: "x", label: "X", hosts: ["x.com", "twitter.com"] },
  { brand: "stackoverflow", label: "Stack Overflow", hosts: ["stackoverflow.com"] },
  { brand: "medium", label: "Medium", hosts: ["medium.com"] },
  { brand: "behance", label: "Behance", hosts: ["behance.net"] },
  { brand: "dribbble", label: "Dribbble", hosts: ["dribbble.com"] },
  { brand: "youtube", label: "YouTube", hosts: ["youtube.com", "youtu.be"] },
];

function hostOf(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    return new URL(withScheme).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Exact host or a subdomain of it — never a substring match. */
function hostMatches(host: string, candidate: string): boolean {
  return host === candidate || host.endsWith(`.${candidate}`);
}

export function detectLinkBrand(url: string): LinkBrand {
  const host = hostOf(url);
  if (!host) return "generic";
  for (const entry of BRAND_HOSTS) {
    if (entry.hosts.some((candidate) => hostMatches(host, candidate))) {
      return entry.brand;
    }
  }
  return "generic";
}

/** The label a recognised URL should carry, or null when unrecognised. */
export function suggestLinkLabel(url: string): string | null {
  const host = hostOf(url);
  if (!host) return null;
  for (const entry of BRAND_HOSTS) {
    if (entry.hosts.some((candidate) => hostMatches(host, candidate))) {
      return entry.label;
    }
  }
  return null;
}

/**
 * Quiet validity check for the blur-time hint. Deliberately permissive: the
 * field accepts "eddyzhang.me" as readily as a full URL, and only flags input
 * that cannot be a web address at all. A resume field should never block on
 * pedantry about a trailing slash.
 */
export function isPlausibleUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (/\s/.test(trimmed)) return false;
  const host = hostOf(trimmed);
  if (!host) return false;
  // Require a dot-separated TLD of at least two letters.
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(host) || host === "localhost";
}

/** Same spirit for email: catch the obviously-wrong, never nag about the rest. */
export function isPlausibleEmail(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed);
}
