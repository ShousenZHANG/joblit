import { z } from "zod";

import { findImpliedYearsField, findYearExpressions } from "./lexical";
import { assessExpression, isSuppressedExpression } from "./ownership";
import {
  capCompleteRelationGroups,
  contextualizeExpressions,
} from "./relations";
import { boundedEvidence, scanEvidenceSpans } from "./structure";
import { EXPERIENCE_OPERATOR_VALUES } from "./types";

export const ExperienceClassificationSchema = z.enum([
  "REQUIRED",
  "STATED",
  "PREFERRED",
  "ALTERNATIVE",
  "REVIEW",
]);

/**
 * v3 preserves strict comparison semantics. Bounds remain convenient for
 * sorting/filtering: lower bounds use `min`, upper bounds use `max`, exact and
 * ranges use both.
 */
export const ExperienceYearsSchema = z
  .object({
    operator: z.enum(EXPERIENCE_OPERATOR_VALUES),
    min: z.number().min(0).max(60),
    max: z.number().min(0).max(60).nullable(),
    text: z.string().min(1).max(80),
  })
  .strict()
  .superRefine((years, context) => {
    if (years.max !== null && years.max < years.min) {
      context.addIssue({
        code: "custom",
        path: ["max"],
        message: "max must be greater than or equal to min",
      });
    }
    if (
      (years.operator === "MORE_THAN" || years.operator === "AT_LEAST") &&
      years.max !== null
    ) {
      context.addIssue({
        code: "custom",
        path: ["max"],
        message: "lower-bound requirements cannot have a maximum",
      });
    }
    if (
      (years.operator === "LESS_THAN" || years.operator === "AT_MOST") &&
      (years.min !== 0 || years.max === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["max"],
        message: "upper-bound requirements need min 0 and a maximum",
      });
    }
    if (
      (years.operator === "EXACT" || years.operator === "RANGE") &&
      years.max === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["max"],
        message: `${years.operator.toLocaleLowerCase("en")} needs a maximum`,
      });
    }
    if (years.operator === "EXACT" && years.max !== years.min) {
      context.addIssue({
        code: "custom",
        path: ["max"],
        message: "exact requirements must have equal bounds",
      });
    }
    if (years.operator === "RANGE" && years.max === years.min) {
      context.addIssue({
        code: "custom",
        path: ["max"],
        message: "ranges must contain two distinct bounds",
      });
    }
  });

export const ExperienceEvidenceSchema = z
  .object({
    text: z.string().min(1).max(2_000),
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    yearsStart: z.number().int().nonnegative(),
    yearsEnd: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((evidence, context) => {
    if (evidence.end < evidence.start) {
      context.addIssue({
        code: "custom",
        path: ["end"],
        message: "evidence end must not precede its start",
      });
    }
    if (
      evidence.yearsStart < evidence.start ||
      evidence.yearsEnd > evidence.end ||
      evidence.yearsEnd < evidence.yearsStart
    ) {
      context.addIssue({
        code: "custom",
        path: ["yearsStart"],
        message: "year offsets must be contained by the evidence span",
      });
    }
  });

export const ExperienceRelationSchema = z
  .object({
    groupId: z.string().min(1).max(160),
    kind: z.enum(["ANY_OF", "ALL_OF"]),
    role: z.enum(["TOTAL", "SUBSET"]).optional(),
  })
  .strict();

export const JobExperienceRequirementSchema = z
  .object({
    id: z.string().min(1).max(160),
    classification: ExperienceClassificationSchema,
    years: ExperienceYearsSchema,
    scope: z.string().min(1).max(160).nullable(),
    evidence: ExperienceEvidenceSchema,
    relation: ExperienceRelationSchema.optional(),
  })
  .strict()
  .superRefine((requirement, context) => {
    if (
      requirement.evidence.end - requirement.evidence.start !==
      requirement.evidence.text.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["evidence", "text"],
        message: "evidence text length must match its source offsets",
      });
    }
    if (
      requirement.evidence.yearsEnd - requirement.evidence.yearsStart !==
      requirement.years.text.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["years", "text"],
        message: "year text length must match its source offsets",
      });
    }
  });

export const JobExperienceAnalysisSchema = z
  .object({
    schemaVersion: z.literal(3),
    status: z.enum(["NONE", "FOUND", "REVIEW"]),
    requirements: z.array(JobExperienceRequirementSchema).max(40),
    truncated: z.boolean().optional(),
  })
  .strict()
  .superRefine((analysis, context) => {
    const hasReview = analysis.requirements.some(
      (item) => item.classification === "REVIEW",
    );
    if (
      analysis.status === "NONE" &&
      (analysis.requirements.length > 0 || analysis.truncated === true)
    ) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "NONE cannot contain requirements",
      });
    }
    if (
      analysis.status === "FOUND" &&
      (analysis.requirements.length === 0 ||
        hasReview ||
        analysis.truncated === true)
    ) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "FOUND needs only classified requirements",
      });
    }
    if (
      analysis.status === "REVIEW" &&
      !hasReview &&
      analysis.truncated !== true
    ) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "REVIEW needs review evidence or truncation",
      });
    }

    const ids = new Set<string>();
    const offsets = analysis.requirements
      .map((item, index) => ({
        index,
        start: item.evidence.yearsStart,
        end: item.evidence.yearsEnd,
      }))
      .sort((a, b) => a.start - b.start || a.end - b.end);
    const groups = new Map<
      string,
      {
        count: number;
        kinds: Set<"ANY_OF" | "ALL_OF">;
        roles: Array<"TOTAL" | "SUBSET" | undefined>;
      }
    >();
    for (const [index, item] of analysis.requirements.entries()) {
      if (ids.has(item.id)) {
        context.addIssue({
          code: "custom",
          path: ["requirements", index, "id"],
          message: "requirement ids must be unique",
        });
      }
      ids.add(item.id);
      if (!item.relation) continue;
      const group = groups.get(item.relation.groupId) ?? {
        count: 0,
        kinds: new Set<"ANY_OF" | "ALL_OF">(),
        roles: [],
      };
      group.count += 1;
      group.kinds.add(item.relation.kind);
      group.roles.push(item.relation.role);
      groups.set(item.relation.groupId, group);
    }
    for (let index = 1; index < offsets.length; index += 1) {
      const previous = offsets[index - 1];
      const current = offsets[index];
      if (previous && current && current.start < previous.end) {
        context.addIssue({
          code: "custom",
          path: ["requirements", current.index, "evidence", "yearsStart"],
          message: "year evidence offsets must not overlap",
        });
      }
    }
    for (const [groupId, group] of groups) {
      if (group.count < 2 || group.kinds.size !== 1) {
        context.addIssue({
          code: "custom",
          path: ["requirements"],
          message: `relation group ${groupId} is incomplete`,
        });
      }
      const nested = group.roles.some((role) => role !== undefined);
      if (
        nested &&
        (!group.kinds.has("ALL_OF") ||
          group.roles.some((role) => role === undefined) ||
          group.roles.filter((role) => role === "TOTAL").length !== 1 ||
          group.roles.filter((role) => role === "SUBSET").length < 1)
      ) {
        context.addIssue({
          code: "custom",
          path: ["requirements"],
          message: `nested relation group ${groupId} is malformed`,
        });
      }
    }
  });

export type JobExperienceRequirement = z.infer<
  typeof JobExperienceRequirementSchema
>;
export type JobExperienceAnalysis = z.infer<typeof JobExperienceAnalysisSchema>;

export const EMPTY_JOB_EXPERIENCE_ANALYSIS: JobExperienceAnalysis = {
  schemaVersion: 3,
  status: "NONE",
  requirements: [],
};

type Draft = {
  requirement: JobExperienceRequirement;
  explicitClassification: "REQUIRED" | "PREFERRED" | null;
  propagationEligible: boolean;
};

/**
 * Analyze quantitative candidate-experience requirements using only
 * deterministic, offline rules. Obvious non-candidate durations are omitted;
 * ambiguous candidate statements remain REVIEW so presentation can hide them.
 */
export function analyzeJobExperience(
  description: string | null | undefined,
): JobExperienceAnalysis {
  if (!description?.trim()) return EMPTY_JOB_EXPERIENCE_ANALYSIS;
  const requirements: JobExperienceRequirement[] = [];

  for (const evidence of scanEvidenceSpans(description)) {
    // The whole-span assessment removes recency windows and foreign owners
    // before relation grouping, so a suppressed `last 5 years` cannot turn a
    // valid `3 years of Java` requirement into a fake two-member relation.
    const lexicalExpressions = findYearExpressions(evidence.text);
    const parsedExpressions =
      lexicalExpressions.length > 0
        ? lexicalExpressions
        : evidence.candidateLabel
          ? findImpliedYearsField(evidence.text, evidence.minimumLabel)
          : [];
    const expressions = parsedExpressions.map((expression) =>
      evidence.minimumLabel && expression.operator === "EXACT"
        ? { ...expression, operator: "AT_LEAST" as const, max: null }
        : expression,
    );
    const candidates = expressions.filter(
      (expression) => !isSuppressedExpression(evidence.text, expression),
    );
    const contextual = contextualizeExpressions(
      evidence.text,
      evidence.start,
      candidates,
    );
    const drafts: Draft[] = [];

    for (const item of contextual) {
      const expression = item.expression;
      const clause = evidence.text.slice(item.clauseStart, item.clauseEnd);
      const localExpression = {
        ...expression,
        start: expression.start - item.clauseStart,
        end: expression.end - item.clauseStart,
      };
      const assessment = assessExpression(
        clause,
        localExpression,
        evidence.context,
        evidence.candidateLabel,
      );
      if (!assessment) continue;
      const yearsStart = evidence.start + expression.start;
      const yearsEnd = evidence.start + expression.end;
      if (
        description.slice(yearsStart, yearsEnd) !== expression.text ||
        yearsStart < evidence.start ||
        yearsEnd > evidence.start + evidence.text.length
      ) {
        continue;
      }
      drafts.push({
        requirement: {
          id: `experience-${yearsStart}-${yearsEnd}`,
          classification: item.forceReview
            ? "REVIEW"
            : assessment.classification,
          years: {
            operator: expression.operator,
            min: expression.min,
            max: expression.max,
            text: expression.text,
          },
          scope: assessment.scope,
          evidence: boundedEvidence(
            description,
            evidence.start,
            evidence.start + evidence.text.length,
            yearsStart,
            yearsEnd,
          ),
          ...(item.relation ? { relation: item.relation } : {}),
        },
        explicitClassification: assessment.explicitClassification,
        propagationEligible:
          !item.forceReview && assessment.propagationEligible,
      });
    }

    const groupId = drafts[0]?.requirement.relation?.groupId;
    const completeGroup =
      drafts.length > 1 &&
      groupId !== undefined &&
      drafts.every((draft) => draft.requirement.relation?.groupId === groupId);
    if (!completeGroup) {
      for (const draft of drafts) delete draft.requirement.relation;
    } else {
      const qualifierSources = drafts.filter(
        (draft) => draft.explicitClassification !== null,
      );
      if (qualifierSources.length === 1) {
        const classification = qualifierSources[0]?.explicitClassification;
        if (classification) {
          for (const draft of drafts) {
            if (draft.propagationEligible) {
              draft.requirement.classification = classification;
            }
          }
        }
      }
    }
    requirements.push(...drafts.map((draft) => draft.requirement));
  }

  const unique = [
    ...new Map(requirements.map((item) => [item.id, item])).values(),
  ];
  const capped = capCompleteRelationGroups(unique, 40);
  const hasReview = capped.requirements.some(
    (item) => item.classification === "REVIEW",
  );
  return JobExperienceAnalysisSchema.parse({
    schemaVersion: 3,
    status: capped.truncated
      ? "REVIEW"
      : capped.requirements.length === 0
        ? "NONE"
        : hasReview
          ? "REVIEW"
          : "FOUND",
    requirements: capped.requirements,
    ...(capped.truncated ? { truncated: true } : {}),
  });
}
