import { z } from "zod";
import {
  ExperienceEvidenceSchema,
  JobExperienceAnalysisSchema,
  type JobExperienceAnalysis,
} from "./jobExperienceAnalysis";

const LegacyExperienceYearsSchema = z
  .object({
    operator: z.enum(["MINIMUM", "RANGE", "MAXIMUM", "EXACT"]),
    min: z.number().int().min(0).max(60),
    max: z.number().int().min(0).max(60).nullable(),
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
    if (years.operator === "MINIMUM" && years.max !== null) {
      context.addIssue({
        code: "custom",
        path: ["max"],
        message: "minimum requirements cannot have a maximum",
      });
    }
    if (
      (years.operator === "RANGE" ||
        years.operator === "MAXIMUM" ||
        years.operator === "EXACT") &&
      years.max === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["max"],
        message: `${years.operator.toLowerCase()} requirements need a maximum`,
      });
    }
    if (years.operator === "MAXIMUM" && years.min !== 0) {
      context.addIssue({
        code: "custom",
        path: ["min"],
        message: "maximum requirements start at zero",
      });
    }
    if (years.operator === "EXACT" && years.max !== years.min) {
      context.addIssue({
        code: "custom",
        path: ["max"],
        message: "exact requirements must have equal bounds",
      });
    }
  });

const LegacyExperienceRelationSchema = z
  .object({
    groupId: z.string().min(1).max(160),
    kind: z.enum(["ANY_OF", "ALL_OF"]),
  })
  .strict();

const LegacyJobExperienceRequirementSchema = z
  .object({
    id: z.string().min(1).max(160),
    classification: z.enum(["REQUIRED", "PREFERRED", "REVIEW"]),
    years: LegacyExperienceYearsSchema,
    scope: z.string().min(1).max(160).nullable(),
    evidence: ExperienceEvidenceSchema,
    relation: LegacyExperienceRelationSchema.optional(),
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

/** Frozen wire contract consumed by application revisions shipped before v2. */
export const LegacyJobExperienceAnalysisSchema = z
  .object({
    schemaVersion: z.literal(1),
    status: z.enum(["NONE", "FOUND", "REVIEW"]),
    requirements: z.array(LegacyJobExperienceRequirementSchema).max(40),
    truncated: z.boolean().optional(),
  })
  .strict()
  .superRefine((analysis, context) => {
    const review = analysis.requirements.some(
      (requirement) => requirement.classification === "REVIEW",
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
        review ||
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
      !review &&
      analysis.truncated !== true
    ) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "REVIEW needs at least one review requirement",
      });
    }

    const seenIds = new Set<string>();
    const relationGroups = new Map<
      string,
      { count: number; kinds: Set<"ANY_OF" | "ALL_OF"> }
    >();
    const orderedOffsets = [...analysis.requirements]
      .map((requirement, index) => ({
        index,
        start: requirement.evidence.yearsStart,
        end: requirement.evidence.yearsEnd,
      }))
      .sort((left, right) => left.start - right.start || left.end - right.end);

    for (const [index, requirement] of analysis.requirements.entries()) {
      if (seenIds.has(requirement.id)) {
        context.addIssue({
          code: "custom",
          path: ["requirements", index, "id"],
          message: "requirement ids must be unique",
        });
      }
      seenIds.add(requirement.id);
      if (requirement.relation) {
        const group = relationGroups.get(requirement.relation.groupId) ?? {
          count: 0,
          kinds: new Set<"ANY_OF" | "ALL_OF">(),
        };
        group.count += 1;
        group.kinds.add(requirement.relation.kind);
        relationGroups.set(requirement.relation.groupId, group);
      }
    }
    for (let index = 1; index < orderedOffsets.length; index += 1) {
      const previous = orderedOffsets[index - 1];
      const current = orderedOffsets[index];
      if (previous && current && current.start < previous.end) {
        context.addIssue({
          code: "custom",
          path: ["requirements", current.index, "evidence", "yearsStart"],
          message: "year evidence offsets must not overlap",
        });
      }
    }
    for (const [groupId, group] of relationGroups) {
      if (group.count < 2 || group.kinds.size !== 1) {
        context.addIssue({
          code: "custom",
          path: ["requirements"],
          message: `relation group ${groupId} must contain at least two members of one kind`,
        });
      }
    }
  });

export type LegacyJobExperienceAnalysis = z.infer<
  typeof LegacyJobExperienceAnalysisSchema
>;
type LegacyJobExperienceRequirement =
  LegacyJobExperienceAnalysis["requirements"][number];

/**
 * Contract a v2 analysis for old clients without rounding or inventing data.
 * Fractional years cannot be represented by v1 and are therefore omitted.
 */
export function projectJobExperienceAnalysisV1(
  analysis: JobExperienceAnalysis,
): LegacyJobExperienceAnalysis {
  const requirements: LegacyJobExperienceRequirement[] = analysis.requirements
    .filter(
      (requirement) =>
        Number.isInteger(requirement.years.min) &&
        (requirement.years.max === null ||
          Number.isInteger(requirement.years.max)),
    )
    .map((requirement) => ({
      id: requirement.id,
      classification:
        requirement.classification === "STATED" ||
        requirement.classification === "ALTERNATIVE"
          ? "REVIEW"
          : requirement.classification,
      years: { ...requirement.years },
      scope: requirement.scope,
      evidence: { ...requirement.evidence },
      ...(requirement.relation
        ? {
            relation: {
              groupId: requirement.relation.groupId,
              kind: requirement.relation.kind,
            },
          }
        : {}),
    }));

  const relationGroups = new Map<
    string,
    { count: number; kinds: Set<"ANY_OF" | "ALL_OF"> }
  >();
  for (const requirement of requirements) {
    if (!requirement.relation) continue;
    const group = relationGroups.get(requirement.relation.groupId) ?? {
      count: 0,
      kinds: new Set<"ANY_OF" | "ALL_OF">(),
    };
    group.count += 1;
    group.kinds.add(requirement.relation.kind);
    relationGroups.set(requirement.relation.groupId, group);
  }
  for (const requirement of requirements) {
    if (!requirement.relation) continue;
    const group = relationGroups.get(requirement.relation.groupId);
    if (!group || group.count < 2 || group.kinds.size !== 1) {
      delete requirement.relation;
    }
  }

  const truncated = analysis.truncated === true;
  const hasReview = requirements.some(
    (requirement) => requirement.classification === "REVIEW",
  );
  const status =
    requirements.length === 0 && !truncated
      ? "NONE"
      : hasReview || truncated
        ? "REVIEW"
        : "FOUND";

  return LegacyJobExperienceAnalysisSchema.parse({
    schemaVersion: 1,
    status,
    requirements,
    ...(truncated ? { truncated: true } : {}),
  });
}

/** Expand an old-server response into the current in-app domain contract. */
export function upgradeJobExperienceAnalysisV1(
  analysis: LegacyJobExperienceAnalysis,
): JobExperienceAnalysis {
  return JobExperienceAnalysisSchema.parse({
    ...analysis,
    schemaVersion: 2,
  });
}
