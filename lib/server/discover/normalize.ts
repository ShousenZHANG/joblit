const TRACKING_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "ref", "source", "fbclid", "gclid", "mc_cid", "mc_eid",
]);

/**
 * URL normalization — strips tracking params, www prefix, trailing slashes,
 * lowercases host. Used as dedup key for cross-source fusion.
 */
export function normalizeUrl(raw: string): string {
  let input = raw.trim();
  if (!input.includes("://")) {
    if (/^[a-z0-9][\w.-]+\.[a-z]{2,}/i.test(input)) {
      input = "https://" + input;
    } else {
      return input;
    }
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return raw;
  }

  // Lowercase host + strip www
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");

  // Remove tracking params
  const params = new URLSearchParams(url.search);
  for (const key of [...params.keys()]) {
    if (TRACKING_PARAMS.has(key)) params.delete(key);
  }

  // Sort remaining params for consistent key
  params.sort();
  url.search = params.toString() ? "?" + params.toString() : "";

  // Strip trailing slash from pathname
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }

  // Remove hash
  url.hash = "";

  return url.toString();
}

function trigrams(s: string): Set<string> {
  const lower = s.toLowerCase();
  const set = new Set<string>();
  for (let i = 0; i <= lower.length - 3; i++) {
    set.add(lower.slice(i, i + 3));
  }
  return set;
}

function jaccardSets(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * 3-gram Jaccard similarity between two strings.
 */
export function trigramJaccard(a: string, b: string): number {
  return jaccardSets(trigrams(a), trigrams(b));
}

const STOPWORDS = new Set([
  "the", "a", "an", "is", "in", "of", "to", "and", "for", "on",
  "with", "at", "by", "it", "or", "be", "as", "are", "was", "this",
  "that", "from", "but", "not", "have", "has", "had", "do", "does",
]);

function tokenize(s: string): Set<string> {
  const set = new Set<string>();
  for (const word of s.toLowerCase().split(/\W+/)) {
    if (word.length > 1 && !STOPWORDS.has(word)) {
      set.add(word);
    }
  }
  return set;
}

/**
 * Token-level Jaccard (stopwords removed, lowercase, length > 1).
 */
export function tokenJaccard(a: string, b: string): number {
  return jaccardSets(tokenize(a), tokenize(b));
}

/**
 * Hybrid similarity = max(trigramJaccard, tokenJaccard).
 */
export function hybridSimilarity(a: string, b: string): number {
  return Math.max(trigramJaccard(a, b), tokenJaccard(a, b));
}
