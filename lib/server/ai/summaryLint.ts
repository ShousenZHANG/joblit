import { extractSkills } from "@/lib/shared/skillsGazetteer";

/**
 * Deterministic checks on the one piece of free text tailoring still writes.
 *
 * The evidence ledger that used to guard generated content was deleted with
 * AI-added bullets: its two blocking rules judged bullets and numeric claims,
 * so once bullets stopped being generated it cost two tables and a review
 * pipeline to guard a single field. This module replaces it for that field.
 *
 * Everything here is string comparison against the candidate's own profile and
 * the target job. Nothing asks a model to judge a model — the retired grounding
 * gate did, and it blocked almost every draft while still admitting claims the
 * profile could not support.
 *
 * Three rules:
 *
 *   1. The summary must name the target role. Mirroring the posting's title is
 *      the single highest-leverage edit on a resume — recruiters search titles
 *      and fixate on them first — and it is the one thing a tailored summary
 *      exists to do. Seniority words are stripped from the requirement: a
 *      candidate may claim the role, not the level a posting asks for.
 *   2. Every number must already appear in the profile. A tailored summary
 *      restates the candidate's record; it does not discover new figures.
 *   3. Every recognised skill must already appear in the profile. Matching runs
 *      through the shared gazetteer, so "React.js" in the summary is satisfied
 *      by "ReactJS" in the profile.
 */

export type SummaryLintFailure =
  | { kind: "title_missing"; requiredTitle: string }
  | { kind: "ungrounded_number"; token: string }
  | { kind: "ungrounded_skill"; skill: string };

export type SummaryLintResult =
  | { ok: true }
  | { ok: false; failure: SummaryLintFailure };

export type SummaryLintInput = {
  summary: string;
  /** The target Job's title, verbatim from the posting. */
  jobTitle: string;
  /** Every string the candidate wrote on their master profile. */
  profileText: string;
};

/**
 * Level words a posting may ask for and a candidate may not simply assert.
 * Stripped from the required title so the rule tests the role, not the rank.
 */
const SENIORITY_WORDS = new Set([
  "junior",
  "jnr",
  "graduate",
  "grad",
  "entry",
  "entry-level",
  "associate",
  "mid",
  "mid-level",
  "intermediate",
  "senior",
  "snr",
  "sr",
  "staff",
  "principal",
  "lead",
  "leader",
  "head",
  "chief",
  "director",
  "vp",
  "distinguished",
  "trainee",
  "intern",
  "i",
  "ii",
  "iii",
  "iv",
]);

/** Trailing qualifiers a posting bolts onto a title but a summary need not. */
const TITLE_TAIL_SEPARATORS = /[–—\-|/,:]|\(/;

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[‐-―]/g, "-")
    .replace(/[^a-z0-9+#.\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The phrase a summary must contain: the posting's title with its trailing
 * qualifiers and seniority words removed.
 *
 * "Senior AI Engineer - Platform (12 month contract)" requires "ai engineer".
 * Returns null when nothing meaningful survives, in which case the rule cannot
 * be applied and is skipped rather than failing closed on a title like "Intern".
 */
export function requiredTitlePhrase(jobTitle: string): string | null {
  const [head] = jobTitle.split(TITLE_TAIL_SEPARATORS);
  const words = normalize(head ?? "")
    .split(" ")
    .filter(Boolean)
    .filter((word) => !SENIORITY_WORDS.has(word));
  if (!words.length) return null;
  return words.join(" ");
}

/**
 * Numeric tokens a reader would read as a claim. A token is the digits with
 * their immediate decorations: "45%", "2,100+", "p95", "3.5x".
 */
function numericTokens(text: string): string[] {
  return text.match(/[a-z]*\d[\d.,]*\+?%?x?/gi) ?? [];
}

/** Just the digits, so "2,100+" is satisfied by "2100" and vice versa. */
function digitsOf(token: string): string {
  return token.replace(/\D/g, "");
}

export function lintGeneratedSummary(
  input: SummaryLintInput,
): SummaryLintResult {
  const summary = input.summary;
  const normalizedSummary = normalize(summary);

  const required = requiredTitlePhrase(input.jobTitle);
  if (required && !normalizedSummary.includes(required)) {
    return { ok: false, failure: { kind: "title_missing", requiredTitle: required } };
  }

  const profileDigits = new Set(
    numericTokens(input.profileText).map(digitsOf).filter(Boolean),
  );
  for (const token of numericTokens(summary)) {
    const digits = digitsOf(token);
    if (!digits || profileDigits.has(digits)) continue;
    return { ok: false, failure: { kind: "ungrounded_number", token } };
  }

  const profileSkills = extractSkills(input.profileText);
  for (const skill of extractSkills(summary)) {
    if (profileSkills.has(skill)) continue;
    return { ok: false, failure: { kind: "ungrounded_skill", skill } };
  }

  return { ok: true };
}

/** Flattens every string a candidate wrote into one haystack for the checks. */
export function profileTextForLint(profile: unknown): string {
  const parts: string[] = [];
  const walk = (value: unknown, depth: number): void => {
    if (depth > 6 || value == null) return;
    if (typeof value === "string" || typeof value === "number") {
      parts.push(String(value));
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) walk(entry, depth + 1);
      return;
    }
    if (typeof value === "object") {
      for (const entry of Object.values(value as Record<string, unknown>)) {
        walk(entry, depth + 1);
      }
    }
  };
  walk(profile, 0);
  return parts.join("\n");
}
