import rightsRules from "@/tools/fetcher/rights_rules.json";
import { DESCRIPTION_EXCLUSION_OPTIONS } from "@/lib/shared/fetchExclusionCriteria";

type Span = { start: number; end: number };

/**
 * GLOBAL and historical AU v1 rows persist the rule ids selected at creation.
 * This matcher deliberately preserves that complete v1 contract. The AU v2
 * recall-safe policy has its own worker boundary and must not be evaluated or
 * inferred here.
 */
const LEGACY_V1_RIGHTS_RULES = new Set([
  "identity_requirement",
  "clearance_requirement",
  "sponsorship_unavailable",
]);

const HARD_ANCHOR_RE = compileUnion(rightsRules.hard_anchors);
const NEGATION_RE = compileUnion(rightsRules.negation_guards);
const SOFT_QUALIFIER_RE = compileUnion(rightsRules.soft_qualifier_guards);
const SOFT_INVITE_RE = compileUnion(rightsRules.soft_invite);
const IDENTITY_TOKEN_RE = compileUnion(rightsRules.regions.GLOBAL.tokens);
const IDENTITY_STANDALONE_RE = compileUnion(
  rightsRules.regions.GLOBAL.standalone_tokens,
);
const GENERIC_IDENTITY_RE = compileUnion(rightsRules.generic_tokens);
const GLOBAL_IDENTITY_RE = compileUnion(rightsRules.global_hard_patterns);
const SPONSORSHIP_RE = compileUnion(rightsRules.sponsorship_phrases);
const CLEARANCE_RE = compileUnion(rightsRules.clearance_tokens);

const EXPERIENCE_PATTERNS = [
  /\b(?:minimum|min\.?|at\s+least|requires?|required|must\s+have|need(?:ed)?|looking\s+for)\s+(?:a\s+)?(?:minimum\s+of\s+)?(\d{1,2})\s*\+?\s*(?:years?|yrs?)\b(?:[^.;]{0,80}\b(?:experience|commercial|professional|development|engineering)\b)?/giu,
  /\b(\d{1,2})\s*\+\s*(?:years?|yrs?)'?\s+(?:of\s+)?(?:commercial\s+|professional\s+|relevant\s+)?experience\b/giu,
  /\b(\d{1,2})\s*(?:years?|yrs?)'?\s+(?:of\s+)?(?:commercial\s+|professional\s+|relevant\s+)?experience\s+(?:is\s+)?(?:required|minimum|needed|essential|must\b)/giu,
  /\b(?:over|more\s+than)\s+(\d{1,2})\s*(?:years?|yrs?)'?\s+(?:of\s+)?(?:commercial\s+|professional\s+|relevant\s+)?experience\b/giu,
  /(\d{1,2}|[一二两三四五六七八九十]{1,3})\s*年\s*(?:以上|及以上|起)\s*(?:工作)?经验/gu,
  /(?:至少|不少于)\s*(\d{1,2}|[一二两三四五六七八九十]{1,3})\s*年\s*(?:工作)?经验/gu,
] as const;

const EXPERIENCE_SOFT_GUARD_RE =
  /\b(?:up\s+to|less\s+than|fewer\s+than|under|within|no\s+more\s+than|maximum|max\.?|preferred|nice\s+to\s+have)\b/iu;
const EXPERIENCE_RANGE_PREFIX_RE = /\d+\s*(?:-|–|—|to)\s*$/iu;

const LEGACY_V1_EXPERIENCE_THRESHOLDS = DESCRIPTION_EXCLUSION_OPTIONS.flatMap(
  (option) =>
    option.category === "experience" && typeof option.minYears === "number"
      ? [{ rule: option.value, minYears: option.minYears }]
      : [],
);

function compileUnion(patterns: readonly string[]): RegExp | null {
  const active = patterns.filter(Boolean);
  return active.length > 0
    ? new RegExp(`(?:${active.join("|")})`, "giu")
    : null;
}

function spans(regex: RegExp | null, text: string): Span[] {
  if (!regex) return [];
  return [...text.matchAll(regex)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
}

function hasMatch(regex: RegExp | null, text: string): boolean {
  return spans(regex, text).length > 0;
}

function overlaps(left: Span, right: Span): boolean {
  return left.start < right.end && right.start < left.end;
}

function isSoftened(text: string, span: Span): boolean {
  const window = rightsRules.proximity.negation_window_chars;
  const nearby = text.slice(
    Math.max(0, span.start - window),
    Math.min(text.length, span.end + window),
  );
  if (hasMatch(NEGATION_RE, nearby)) return true;

  const trailingWindow = rightsRules.proximity.soft_qualifier_window_chars;
  const trailing = text.slice(
    span.end,
    Math.min(text.length, span.end + trailingWindow),
  );
  const boundary = trailing.search(/[.;!?\n]/u);
  return hasMatch(
    SOFT_QUALIFIER_RE,
    boundary >= 0 ? trailing.slice(0, boundary) : trailing,
  );
}

function withinAnchorWindow(span: Span, anchors: readonly Span[]): boolean {
  const window = rightsRules.proximity.anchor_to_token_chars;
  return anchors.some((anchor) => {
    if (overlaps(span, anchor)) return true;
    if (anchor.end <= span.start) return span.start - anchor.end <= window;
    return anchor.start - span.end <= window;
  });
}

function violatesRightsRules(text: string, rules: ReadonlySet<string>): boolean {
  const identityOn = rules.has("identity_requirement");
  const clearanceOn = rules.has("clearance_requirement");
  const sponsorshipOn = rules.has("sponsorship_unavailable");
  const anchors = spans(HARD_ANCHOR_RE, text);
  let score = 0;

  if (identityOn) {
    for (const span of spans(IDENTITY_STANDALONE_RE, text)) {
      if (!isSoftened(text, span)) score += 60;
    }
    for (const span of spans(GLOBAL_IDENTITY_RE, text)) {
      if (!isSoftened(text, span)) score += 60;
    }

    const identitySpans: Span[] = [];
    for (const span of spans(IDENTITY_TOKEN_RE, text)) {
      if (!isSoftened(text, span) && withinAnchorWindow(span, anchors)) {
        identitySpans.push(span);
        score += 60;
      }
    }
    for (const span of spans(GENERIC_IDENTITY_RE, text)) {
      if (
        !identitySpans.some((identitySpan) => overlaps(span, identitySpan)) &&
        !isSoftened(text, span) &&
        withinAnchorWindow(span, anchors)
      ) {
        score += 35;
      }
    }
    for (const span of spans(SPONSORSHIP_RE, text)) {
      if (!isSoftened(text, span)) score += 60;
    }
  } else if (sponsorshipOn) {
    for (const span of spans(SPONSORSHIP_RE, text)) {
      if (!isSoftened(text, span)) score += 60;
    }
  }

  if (clearanceOn) {
    for (const span of spans(CLEARANCE_RE, text)) {
      if (!isSoftened(text, span)) score += 60;
    }
  }

  if (hasMatch(SOFT_INVITE_RE, text)) score -= 50;
  return Math.max(0, score) >= rightsRules.strictness_thresholds.balanced;
}

function parseChineseNumber(raw: string): number | null {
  if (/^\d+$/u.test(raw)) return Number(raw);
  const digit: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  if (raw === "十") return 10;
  const tenIndex = raw.indexOf("十");
  if (tenIndex < 0) return digit[raw] ?? null;
  const tens = tenIndex === 0 ? 1 : digit[raw.slice(0, tenIndex)] ?? 0;
  const ones =
    tenIndex === raw.length - 1
      ? 0
      : digit[raw.slice(tenIndex + 1)] ?? 0;
  return tens * 10 + ones;
}

function violatesExperienceRules(
  text: string,
  rules: ReadonlySet<string>,
): boolean {
  const thresholds = LEGACY_V1_EXPERIENCE_THRESHOLDS.filter(({ rule }) =>
    rules.has(rule),
  );
  if (thresholds.length === 0) return false;

  for (const pattern of EXPERIENCE_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const years = parseChineseNumber(match[1] ?? "");
      if (years === null) continue;
      const start = match.index;
      const end = start + match[0].length;
      const prefix = text.slice(Math.max(0, start - 28), start);
      const suffix = text.slice(end, Math.min(text.length, end + 36));
      if (
        EXPERIENCE_SOFT_GUARD_RE.test(`${prefix} ${suffix}`) ||
        EXPERIENCE_RANGE_PREFIX_RE.test(prefix)
      ) {
        continue;
      }
      if (thresholds.some(({ minYears }) => years >= minYears)) return true;
    }
  }
  return false;
}

/**
 * Returns true only for deterministic v1 hard exclusions. Missing descriptions
 * stay eligible so a thin public feed does not silently become an empty feed.
 */
export function violatesDescriptionExclusions(
  description: string | null | undefined,
  activeRules: readonly string[],
): boolean {
  if (!description?.trim() || activeRules.length === 0) return false;
  const rules = new Set(activeRules);
  const rightsRulesEnabled = new Set(
    [...rules].filter((rule) => LEGACY_V1_RIGHTS_RULES.has(rule)),
  );
  return (
    violatesRightsRules(description, rightsRulesEnabled) ||
    violatesExperienceRules(description, rules)
  );
}
