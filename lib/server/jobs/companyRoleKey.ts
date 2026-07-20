// A soft "same opening" key for detecting a posting that reappears under a new
// URL — an agency re-post, a board migration, or the same role re-listed.
//
// Deliberately NOT a unique constraint. Two genuinely different openings can
// collapse onto one key ("Backend Engineer" twice on different teams), so this
// is a hint the UI can surface as "possible duplicate", never grounds to drop
// a row. URL identity stays the only hard dedup, and DeletedJobUrl stays the
// only removal path.

/** Words that appear in titles without identifying which opening it is. */
const ROLE_STOPWORDS = new Set([
  // seniority / level
  "junior", "jr", "mid", "middle", "senior", "snr", "sr", "staff", "principal",
  "lead", "head", "chief", "associate", "intern", "entry", "level", "grad",
  "graduate", "distinguished", "experienced",
  // contract shape / work mode
  "remote", "hybrid", "onsite", "onsight", "contract", "contractor",
  "freelance", "fulltime", "parttime", "permanent", "temporary", "internship",
  "casual", "fixed", "term",
  // generic filler
  "role", "position", "opportunity", "team", "based", "for", "the", "and",
  "with", "to", "of", "in", "at", "an", "a", "new", "our",
  // reposting annotations
  "repost", "reposted", "relisted", "urgent", "hiring",
  // common AU/global locations
  "sydney", "melbourne", "brisbane", "perth", "adelaide", "canberra", "hobart",
  "darwin", "nsw", "vic", "qld", "wa", "sa", "tas", "act", "nt", "australia",
  "london", "berlin", "paris", "amsterdam", "dublin", "york", "francisco",
  "seattle", "boston", "austin", "chicago", "toronto", "tokyo", "singapore",
  "lisbon", "warsaw", "europe", "emea", "apac", "latam", "americas", "global",
  "worldwide", "anywhere",
]);

/** Legal suffixes that do not distinguish one employer from another. */
const COMPANY_SUFFIXES = new Set([
  "pty", "ltd", "limited", "inc", "incorporated", "llc", "llp", "gmbh", "corp",
  "corporation", "co", "plc", "sa", "ag", "bv", "nv", "oy", "ab", "as",
  "holdings", "group",
]);

/** Chinese seniority prefixes; the CJK path has no spaces to tokenize on, so
 *  these are stripped as substrings instead. */
const CJK_SENIORITY_TERMS = [
  "高级", "资深", "初级", "中级", "首席", "应届", "校招", "急聘", "诚聘",
];

const CJK_RE = /[㐀-鿿]/;
const MAX_KEY_LENGTH = 200;

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9㐀-鿿]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function companySlug(company: string): string {
  const tokens = tokenize(company).filter((t) => !COMPANY_SUFFIXES.has(t));
  // A company whose entire name is a legal suffix keeps its raw tokens rather
  // than collapsing to nothing.
  const usable = tokens.length ? tokens : tokenize(company);
  return usable.join("");
}

function roleSlug(title: string): string {
  if (CJK_RE.test(title)) {
    // Chinese titles are unspaced, so token-level stopword removal never fires.
    // Strip seniority terms as substrings and keep the remainder verbatim.
    let value = title.toLowerCase();
    for (const term of CJK_SENIORITY_TERMS) {
      value = value.split(term).join("");
    }
    return value.replace(/[^a-z0-9㐀-鿿]+/g, "");
  }

  const tokens = tokenize(title).filter((t) => !ROLE_STOPWORDS.has(t));
  // Sorted + deduped so word order and repetition cannot split one opening
  // across two keys.
  return [...new Set(tokens)].sort().join("-");
}

export function buildCompanyRoleKey(input: {
  company?: string | null;
  title?: string | null;
}): string | null {
  const company = (input.company ?? "").trim();
  const title = (input.title ?? "").trim();
  if (!company || !title) return null;

  const slug = companySlug(company);
  const role = roleSlug(title);
  if (!slug || !role) return null;

  return `${slug}::${role}`.slice(0, MAX_KEY_LENGTH);
}
