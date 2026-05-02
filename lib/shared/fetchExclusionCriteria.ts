import manifest from "./fetchExclusionCriteria.config.json";

export type FetchExclusionCategory = "rights" | "experience";

export type TitleExclusionOption = {
  value: string;
  label: string;
};

export type DescriptionExclusionOption = {
  value: string;
  label: string;
  category: FetchExclusionCategory;
  help: string;
  minYears?: number;
};

export const TITLE_EXCLUSION_OPTIONS =
  manifest.titleTerms as readonly TitleExclusionOption[];

export const DESCRIPTION_EXCLUSION_OPTIONS =
  manifest.descriptionRules as readonly DescriptionExclusionOption[];

export const TITLE_EXCLUSION_VALUES = TITLE_EXCLUSION_OPTIONS.map((item) => item.value);

export const DESCRIPTION_EXCLUSION_VALUES = DESCRIPTION_EXCLUSION_OPTIONS.map(
  (item) => item.value,
);

const TITLE_EXCLUSION_SET = new Set(TITLE_EXCLUSION_VALUES);
const DESCRIPTION_EXCLUSION_SET = new Set(DESCRIPTION_EXCLUSION_VALUES);

export function isTitleExclusionTerm(value: string): boolean {
  return TITLE_EXCLUSION_SET.has(value);
}

export function isDescriptionExclusionRule(value: string): boolean {
  return DESCRIPTION_EXCLUSION_SET.has(value);
}

export function filterDescriptionExclusionRules(rules: readonly string[]): string[] {
  return rules.filter(isDescriptionExclusionRule);
}
