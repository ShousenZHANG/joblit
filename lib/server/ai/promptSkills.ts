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

/* ── V2 structured rule types ── */

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

const DEFAULT_HARD_CONSTRAINTS: string[] = [
  "Return JSON only (no code fences, no markdown prose outside JSON). Markdown bold markers inside JSON string values are allowed when explicitly requested.",
  "Do not output LaTeX in model response.",
  "Never invent skills, tools, metrics, employers, or responsibilities not in provided context.",
  "If JD responsibilities or required skills are unclear, keep edits conservative and only add content when grounded in provided context.",
];

export const DEFAULT_RULES: PromptSkillRuleSet = {
  id: "jobflow-default-v1",
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

/* ── V2 structured rules ── */

const SKILL_PACK_VERSION = "2.0.0";

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
    id: `jobflow-v2-${locale}`,
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
 * Flatten a StructuredRuleSet back into the V1 PromptSkillRuleSet format
 * for backward compatibility with internal AI calling code.
 */
export function flattenStructuredRules(
  structured: StructuredRuleSet,
): PromptSkillRuleSet {
  return {
    id: structured.id,
    locale: structured.locale,
    cvRules: structured.rules
      .filter((r) => r.appliesTo.includes("resume"))
      .map((r) => r.text),
    coverRules: structured.rules
      .filter((r) => r.appliesTo.includes("cover"))
      .map((r) => r.text),
    hardConstraints: structured.hardConstraints.map((r) => r.text),
  };
}
