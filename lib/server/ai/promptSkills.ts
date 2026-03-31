import { DEFAULT_COVER_RULES, DEFAULT_CV_RULES } from "@/lib/shared/aiPromptDefaults";

export type PromptSkillRuleSet = {
  id: string;
  locale: "en-AU";
  cvRules: string[];
  coverRules: string[];
  hardConstraints: string[];
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
