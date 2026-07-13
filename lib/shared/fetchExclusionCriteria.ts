import manifest from "./fetchExclusionCriteria.config.json";

type FetchExclusionCategory = "rights" | "experience";

type TitleExclusionOption = {
  value: string;
  label: string;
};

type DescriptionExclusionOption = {
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

const DESCRIPTION_EXCLUSION_VALUES = DESCRIPTION_EXCLUSION_OPTIONS.map(
  (item) => item.value,
);

const DESCRIPTION_EXCLUSION_SET = new Set(DESCRIPTION_EXCLUSION_VALUES);

function isDescriptionExclusionRule(value: string): boolean {
  return DESCRIPTION_EXCLUSION_SET.has(value);
}

export function filterDescriptionExclusionRules(rules: readonly string[]): string[] {
  return rules.filter(isDescriptionExclusionRule);
}
