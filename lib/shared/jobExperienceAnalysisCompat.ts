import { z } from "zod";

import {
  ExperienceEvidenceSchema,
  ExperienceRelationSchema,
  JobExperienceAnalysisSchema,
  type JobExperienceAnalysis,
} from "./jobExperienceAnalysis";

const LegacyOperatorSchema = z.enum(["MINIMUM", "RANGE", "MAXIMUM", "EXACT"]);

function legacyYearsSchema(integer: boolean) {
  const value = integer
    ? z.number().int().min(0).max(60)
    : z.number().min(0).max(60);
  return z
    .object({
      operator: LegacyOperatorSchema,
      min: value,
      max: value.nullable(),
      text: z.string().min(1).max(80),
    })
    .strict()
    .superRefine((years, context) => {
      if (years.max !== null && years.max < years.min) {
        context.addIssue({
          code: "custom",
          path: ["max"],
          message: "invalid bounds",
        });
      }
      if (years.operator === "MINIMUM" && years.max !== null) {
        context.addIssue({
          code: "custom",
          path: ["max"],
          message: "minimum has no max",
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
          message: "maximum required",
        });
      }
      if (years.operator === "MAXIMUM" && years.min !== 0) {
        context.addIssue({
          code: "custom",
          path: ["min"],
          message: "maximum starts at zero",
        });
      }
      if (years.operator === "EXACT" && years.min !== years.max) {
        context.addIssue({
          code: "custom",
          path: ["max"],
          message: "exact bounds differ",
        });
      }
    });
}

const LegacyExperienceYearsV1Schema = legacyYearsSchema(true);
export const LegacyExperienceYearsV2Schema = legacyYearsSchema(false);

const LegacyRelationV1Schema = z
  .object({
    groupId: z.string().min(1).max(160),
    kind: z.enum(["ANY_OF", "ALL_OF"]),
  })
  .strict();

function refineLegacyRequirement(
  requirement: {
    years: { text: string };
    evidence: z.infer<typeof ExperienceEvidenceSchema>;
  },
  context: z.RefinementCtx,
) {
  if (
    requirement.evidence.end - requirement.evidence.start !==
      requirement.evidence.text.length ||
    requirement.evidence.yearsEnd - requirement.evidence.yearsStart !==
      requirement.years.text.length
  ) {
    context.addIssue({
      code: "custom",
      path: ["evidence"],
      message: "legacy evidence offsets are inconsistent",
    });
  }
}

const RequirementV1Schema = z
  .object({
    id: z.string().min(1).max(160),
    classification: z.enum(["REQUIRED", "PREFERRED", "REVIEW"]),
    years: LegacyExperienceYearsV1Schema,
    scope: z.string().min(1).max(160).nullable(),
    evidence: ExperienceEvidenceSchema,
    relation: LegacyRelationV1Schema.optional(),
  })
  .strict()
  .superRefine(refineLegacyRequirement);

const RequirementV2Schema = z
  .object({
    id: z.string().min(1).max(160),
    classification: z.enum([
      "REQUIRED",
      "STATED",
      "PREFERRED",
      "ALTERNATIVE",
      "REVIEW",
    ]),
    years: LegacyExperienceYearsV2Schema,
    scope: z.string().min(1).max(160).nullable(),
    evidence: ExperienceEvidenceSchema,
    relation: ExperienceRelationSchema.optional(),
  })
  .strict()
  .superRefine(refineLegacyRequirement);

function refineLegacyAnalysis(
  analysis: {
    status: "NONE" | "FOUND" | "REVIEW";
    requirements: Array<{
      id: string;
      classification: string;
      relation?: { groupId: string; kind: "ANY_OF" | "ALL_OF" };
    }>;
    truncated?: boolean;
  },
  context: z.RefinementCtx,
) {
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
      message: "invalid NONE",
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
      message: "invalid FOUND",
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
      message: "invalid REVIEW",
    });
  }
  const ids = new Set<string>();
  const groups = new Map<string, { count: number; kinds: Set<string> }>();
  for (const [index, item] of analysis.requirements.entries()) {
    if (ids.has(item.id)) {
      context.addIssue({
        code: "custom",
        path: ["requirements", index, "id"],
        message: "duplicate id",
      });
    }
    ids.add(item.id);
    if (!item.relation) continue;
    const group = groups.get(item.relation.groupId) ?? {
      count: 0,
      kinds: new Set<string>(),
    };
    group.count += 1;
    group.kinds.add(item.relation.kind);
    groups.set(item.relation.groupId, group);
  }
  for (const [id, group] of groups) {
    if (group.count < 2 || group.kinds.size !== 1) {
      context.addIssue({
        code: "custom",
        path: ["requirements"],
        message: `incomplete legacy relation ${id}`,
      });
    }
  }
}

/** Frozen integer-only contract shipped before v2. */
export const LegacyJobExperienceAnalysisSchema = z
  .object({
    schemaVersion: z.literal(1),
    status: z.enum(["NONE", "FOUND", "REVIEW"]),
    requirements: z.array(RequirementV1Schema).max(40),
    truncated: z.boolean().optional(),
  })
  .strict()
  .superRefine(refineLegacyAnalysis);

/** Frozen fractional-year contract shipped before precise comparisons. */
export const LegacyJobExperienceAnalysisV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    status: z.enum(["NONE", "FOUND", "REVIEW"]),
    requirements: z.array(RequirementV2Schema).max(40),
    truncated: z.boolean().optional(),
  })
  .strict()
  .superRefine(refineLegacyAnalysis);

export type LegacyJobExperienceAnalysis = z.infer<
  typeof LegacyJobExperienceAnalysisSchema
>;
export type LegacyJobExperienceAnalysisV2 = z.infer<
  typeof LegacyJobExperienceAnalysisV2Schema
>;

function legacyStatus(
  requirements: Array<{ classification: string }>,
  truncated: boolean,
): "NONE" | "FOUND" | "REVIEW" {
  if (requirements.length === 0 && !truncated) return "NONE";
  return truncated ||
    requirements.some((item) => item.classification === "REVIEW")
    ? "REVIEW"
    : "FOUND";
}

function pruneOrphanRelations<
  T extends { relation?: { groupId: string; kind: string } },
>(requirements: T[]): T[] {
  const groups = new Map<string, { count: number; kinds: Set<string> }>();
  for (const item of requirements) {
    if (!item.relation) continue;
    const group = groups.get(item.relation.groupId) ?? {
      count: 0,
      kinds: new Set<string>(),
    };
    group.count += 1;
    group.kinds.add(item.relation.kind);
    groups.set(item.relation.groupId, group);
  }
  return requirements.map((item) => {
    if (!item.relation) return item;
    const group = groups.get(item.relation.groupId);
    if (group && group.count >= 2 && group.kinds.size === 1) return item;
    const clone = { ...item };
    delete clone.relation;
    return clone;
  });
}

function projectYearsV2(
  years: JobExperienceAnalysis["requirements"][number]["years"],
): z.infer<typeof LegacyExperienceYearsV2Schema> {
  switch (years.operator) {
    case "MORE_THAN":
    case "AT_LEAST":
      return { ...years, operator: "MINIMUM", max: null };
    case "LESS_THAN":
    case "AT_MOST":
      return { ...years, operator: "MAXIMUM", min: 0, max: years.max };
    case "RANGE":
    case "EXACT":
      return { ...years, operator: years.operator };
  }
}

/**
 * Contract v3 for a v2 caller. Strict open bounds intentionally degrade to
 * the closest inclusive legacy operator; numeric values are never changed.
 */
export function projectJobExperienceAnalysisV2(
  analysis: JobExperienceAnalysis,
): LegacyJobExperienceAnalysisV2 {
  const requirements = analysis.requirements.map((item) => ({
    ...item,
    years: projectYearsV2(item.years),
  }));
  const truncated = analysis.truncated === true;
  return LegacyJobExperienceAnalysisV2Schema.parse({
    schemaVersion: 2,
    status: legacyStatus(requirements, truncated),
    requirements,
    ...(truncated ? { truncated: true } : {}),
  });
}

/** Project v3 through v2 into the frozen integer-only v1 contract. */
export function projectJobExperienceAnalysisV1(
  analysis: JobExperienceAnalysis,
): LegacyJobExperienceAnalysis {
  const v2 = projectJobExperienceAnalysisV2(analysis);
  const requirements = pruneOrphanRelations(
    v2.requirements
      .filter(
        (item) =>
          Number.isInteger(item.years.min) &&
          (item.years.max === null || Number.isInteger(item.years.max)),
      )
      .map((item) => ({
        id: item.id,
        classification:
          item.classification === "STATED" ||
          item.classification === "ALTERNATIVE"
            ? ("REVIEW" as const)
            : item.classification,
        years: item.years,
        scope: item.scope,
        evidence: item.evidence,
        ...(item.relation
          ? {
              relation: {
                groupId: item.relation.groupId,
                kind: item.relation.kind,
              },
            }
          : {}),
      })),
  );
  const truncated = analysis.truncated === true;
  return LegacyJobExperienceAnalysisSchema.parse({
    schemaVersion: 1,
    status: legacyStatus(requirements, truncated),
    requirements,
    ...(truncated ? { truncated: true } : {}),
  });
}

function upgradeYearsV2(
  years: LegacyJobExperienceAnalysisV2["requirements"][number]["years"],
): JobExperienceAnalysis["requirements"][number]["years"] {
  switch (years.operator) {
    case "MINIMUM":
      return { ...years, operator: "AT_LEAST", max: null };
    case "MAXIMUM":
      return { ...years, operator: "AT_MOST", min: 0 };
    case "RANGE":
    case "EXACT":
      return { ...years, operator: years.operator };
  }
}

/** Expand a v2 response without inventing strictness it did not encode. */
export function upgradeJobExperienceAnalysisV2(
  analysis: LegacyJobExperienceAnalysisV2,
): JobExperienceAnalysis {
  return JobExperienceAnalysisSchema.parse({
    ...analysis,
    schemaVersion: 3,
    requirements: analysis.requirements.map((item) => ({
      ...item,
      years: upgradeYearsV2(item.years),
    })),
  });
}

/** Expand an old integer response through the v2 compatibility model. */
export function upgradeJobExperienceAnalysisV1(
  analysis: LegacyJobExperienceAnalysis,
): JobExperienceAnalysis {
  return upgradeJobExperienceAnalysisV2(
    LegacyJobExperienceAnalysisV2Schema.parse({
      ...analysis,
      schemaVersion: 2,
    }),
  );
}
