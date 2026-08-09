export const EXPERIENCE_OPERATOR_VALUES = [
  "MORE_THAN",
  "AT_LEAST",
  "LESS_THAN",
  "AT_MOST",
  "EXACT",
  "RANGE",
] as const;

export type ExperienceOperator = (typeof EXPERIENCE_OPERATOR_VALUES)[number];

export type HeadingContext = "REQUIRED" | "PREFERRED" | null;

export type YearExpression = {
  operator: ExperienceOperator;
  min: number;
  max: number | null;
  start: number;
  end: number;
  text: string;
  ambiguous: boolean;
};

export type RelationDraft = {
  groupId: string;
  kind: "ANY_OF" | "ALL_OF";
  role?: "TOTAL" | "SUBSET";
};

export type ContextualYearExpression = {
  expression: YearExpression;
  clauseStart: number;
  clauseEnd: number;
  relation?: RelationDraft;
  forceReview: boolean;
};

export type EvidenceSpan = {
  text: string;
  start: number;
  context: HeadingContext;
  candidateLabel: boolean;
  minimumLabel: boolean;
};
