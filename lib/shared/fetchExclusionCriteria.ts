import manifest from "./fetchExclusionCriteria.config.json";

type FetchExclusionCategory = "rights" | "experience";

type DescriptionExclusionOption = {
  value: string;
  label: string;
  category: FetchExclusionCategory;
  help: string;
  minYears?: number;
};

export const DESCRIPTION_EXCLUSION_OPTIONS =
  manifest.descriptionRules as readonly DescriptionExclusionOption[];

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
