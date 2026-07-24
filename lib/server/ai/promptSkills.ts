import {
  DEFAULT_COVER_RULES,
  DEFAULT_CV_RULES,
  STRUCTURED_CV_RULES,
  STRUCTURED_COVER_RULES,
  STRUCTURED_HARD_CONSTRAINTS,
} from "@/lib/shared/aiPromptDefaults";

export type PromptSkillRuleSet = {
  id: string;
  locale: "en-AU" | "zh-CN";
  cvRules: string[];
  coverRules: string[];
  hardConstraints: string[];
};

/* ── Structured rule types ── */

export type RuleCategory =
  | "grounding"
  | "structure"
  | "content"
  | "style"
  | "ats"
  | "coverage"
  | "locale";

export type SkillRule = {
  id: string;
  category: RuleCategory;
  priority: "critical" | "high" | "normal";
  text: string;
  appliesTo: ("resume" | "cover")[];
  locale?: "en-AU" | "zh-CN" | "all";
};

export type StructuredRuleSet = {
  id: string;
  version: string;
  locale: "en-AU" | "zh-CN";
  rules: SkillRule[];
  hardConstraints: SkillRule[];
};

const DEFAULT_HARD_CONSTRAINTS = STRUCTURED_HARD_CONSTRAINTS.map(
  (rule) => rule.text,
);

export const DEFAULT_RULES: PromptSkillRuleSet = {
  id: "joblit-default-v3",
  locale: "en-AU",
  cvRules: DEFAULT_CV_RULES,
  coverRules: DEFAULT_COVER_RULES,
  hardConstraints: DEFAULT_HARD_CONSTRAINTS,
};

type PromptSkillOverrides = Partial<Pick<PromptSkillRuleSet, "cvRules" | "coverRules">>;

export function getPromptSkillRules(
  overrides?: PromptSkillOverrides,
): PromptSkillRuleSet {
  return {
    ...DEFAULT_RULES,
    cvRules:
      overrides?.cvRules && overrides.cvRules.length > 0
        ? overrides.cvRules
        : DEFAULT_RULES.cvRules,
    coverRules:
      overrides?.coverRules && overrides.coverRules.length > 0
        ? overrides.coverRules
        : DEFAULT_RULES.coverRules,
  };
}

/* ── V3 structured rules ── */

export const SKILL_PACK_VERSION = "3.0.0";

/**
 * Build a StructuredRuleSet for the given locale.
 * Filters rules by locale ("all" or matching) and merges locale-specific overrides.
 */
export function getStructuredSkillRules(
  locale: "en-AU" | "zh-CN" = "en-AU",
): StructuredRuleSet {
  const filterByLocale = (rule: SkillRule) =>
    !rule.locale || rule.locale === "all" || rule.locale === locale;

  return {
    id: `joblit-v3-${locale}`,
    version: SKILL_PACK_VERSION,
    locale,
    rules: [
      ...STRUCTURED_CV_RULES.filter(filterByLocale),
      ...STRUCTURED_COVER_RULES.filter(filterByLocale),
    ],
    hardConstraints: STRUCTURED_HARD_CONSTRAINTS.filter(filterByLocale),
  };
}

/**
 * Lift an already-normalized active rule template into the structured
 * representation consumed by Skill Pack generation.
 *
 * Active templates store ordered strings rather than category metadata. Keep
 * that order and content exact: generated metadata is deliberately generic so
 * packaging never replaces user rules with defaults or infers semantics that
 * are not present in the template.
 */
export function buildStructuredSkillRulesFromEffective(
  effective: PromptSkillRuleSet,
  locale: "en-AU" | "zh-CN" = effective.locale,
): StructuredRuleSet {
  const toTargetRules = (
    texts: string[],
    target: "resume" | "cover",
  ): SkillRule[] =>
    texts.map((text, index) => ({
      id: `effective.${target}.${String(index + 1).padStart(2, "0")}`,
      category: "content",
      priority: "high",
      text,
      appliesTo: [target],
      locale: "all",
    }));

  return {
    id: effective.id,
    version: SKILL_PACK_VERSION,
    locale,
    rules: [
      ...toTargetRules(effective.cvRules, "resume"),
      ...toTargetRules(effective.coverRules, "cover"),
    ],
    hardConstraints: effective.hardConstraints.map((text, index) => ({
      id: `effective.hard.${String(index + 1).padStart(2, "0")}`,
      category: "structure",
      priority: "critical",
      text,
      appliesTo: ["resume", "cover"],
      locale: "all",
    })),
  };
}

/**
 * Flatten a StructuredRuleSet back into the V1 PromptSkillRuleSet format
 * for backward compatibility with internal AI calling code.
 */
const PRIORITY_ORDER: Record<SkillRule["priority"], number> = {
  critical: 0,
  high: 1,
  normal: 2,
};

function sortByPriority(rules: SkillRule[]): SkillRule[] {
  return [...rules].sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
}

/**
 * Flatten a StructuredRuleSet back into the V1 PromptSkillRuleSet format
 * for backward compatibility with internal AI calling code.
 * Rules are sorted by priority (critical first).
 */
export function flattenStructuredRules(
  structured: StructuredRuleSet,
): PromptSkillRuleSet {
  return {
    id: structured.id,
    locale: structured.locale,
    cvRules: sortByPriority(structured.rules)
      .filter((r) => r.appliesTo.includes("resume"))
      .map((r) => r.text),
    coverRules: sortByPriority(structured.rules)
      .filter((r) => r.appliesTo.includes("cover"))
      .map((r) => r.text),
    hardConstraints: structured.hardConstraints.map((r) => r.text),
  };
}
