import { createHash } from "node:crypto";
import { z } from "zod";
import {
  CoverGenerationOutputSchema,
  ResumeGenerationOutputSchema,
} from "@/lib/shared/schemas/applicationGenerationOutput";
export {
  CoverGenerationOutputSchema,
  ResumeGenerationOutputSchema,
  type CoverGenerationOutput,
  type ResumeGenerationOutput,
} from "@/lib/shared/schemas/applicationGenerationOutput";

export type PromptTarget = "resume" | "cover";
/** Prompt targets that produce non-application artifacts (job-fit triage). */
export type ExtendedPromptTarget = PromptTarget | "match" | "triage";
export type PromptVariant = "full" | "lean";

export const PROMPT_TEMPLATE_VERSION = "2026.07.v2";
export const PROMPT_SCHEMA_VERSION = "2026-07-24";

export type PromptMeta = {
  ruleSetId: string;
  resumeSnapshotUpdatedAt: string;
  promptTemplateVersion: string;
  schemaVersion: string;
  skillPackVersion: string;
  promptHash: string;
};

type ImportedPromptMeta = Pick<PromptMeta, "ruleSetId" | "resumeSnapshotUpdatedAt"> &
  Partial<
    Pick<PromptMeta, "promptTemplateVersion" | "schemaVersion" | "skillPackVersion" | "promptHash">
  >;

type PromptMetaMismatch = {
  field: keyof ImportedPromptMeta;
  expected: string;
  received: string;
};

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`)
    .join(",")}}`;
}

/**
 * Content-address one of the bounded snapshots used to construct a prompt.
 *
 * TailoringRun persists only this digest (and the PromptMeta receipt), never
 * the prompt or source snapshot itself. Exporting the same canonicalizer used
 * by PromptMeta prevents the run protocol from inventing a second notion of
 * snapshot equality.
 */
export function buildPromptSnapshotHash(value: unknown): string {
  return createHash("sha256").update(stableSerialize(value)).digest("hex");
}

type JsonSchemaNode = {
  type?: string;
  properties?: Record<string, JsonSchemaNode>;
  items?: JsonSchemaNode;
  [key: string]: unknown;
};

function toPromptJsonSchema(schema: z.ZodType): JsonSchemaNode {
  return z.toJSONSchema(schema, {
    target: "draft-2020-12",
    unrepresentable: "throw",
  }) as JsonSchemaNode;
}

function shapeFromJsonSchema(schema: JsonSchemaNode): unknown {
  if (schema.type === "object") {
    return Object.fromEntries(
      Object.entries(schema.properties ?? {}).map(([key, property]) => [
        key,
        shapeFromJsonSchema(property),
      ]),
    );
  }
  if (schema.type === "array") {
    return [shapeFromJsonSchema(schema.items ?? {})];
  }
  if (schema.type === "boolean") return "boolean";
  if (schema.type === "integer" || schema.type === "number") return "number";
  return "string";
}

const RESUME_OUTPUT_JSON_SCHEMA = toPromptJsonSchema(
  ResumeGenerationOutputSchema,
);
const COVER_OUTPUT_JSON_SCHEMA = toPromptJsonSchema(
  CoverGenerationOutputSchema,
);
const RESUME_OUTPUT_SHAPE = shapeFromJsonSchema(
  RESUME_OUTPUT_JSON_SCHEMA,
) as {
  cvSummary: "string";
  latestExperience: { addedBullets: ["string"] };
};
const COVER_OUTPUT_SHAPE = shapeFromJsonSchema(COVER_OUTPUT_JSON_SCHEMA) as {
  cover: {
    paragraphOne: "string";
    paragraphTwo: "string";
    paragraphThree: "string";
  };
};

export function getExpectedJsonShapeForTarget(target: PromptTarget) {
  return target === "resume" ? RESUME_OUTPUT_SHAPE : COVER_OUTPUT_SHAPE;
}

export function getExpectedJsonSchemaForTarget(target: PromptTarget) {
  return target === "resume" ? RESUME_OUTPUT_JSON_SCHEMA : COVER_OUTPUT_JSON_SCHEMA;
}

export function buildPromptContentHash(input: {
  target: ExtendedPromptTarget;
  ruleSetId: string;
  resumeSnapshotUpdatedAt: string;
  locale?: string;
  variant?: PromptVariant;
  prompt?: {
    instructions: string;
    input: string;
  };
  effectiveRules?: unknown;
  resumeSnapshot?: unknown;
  jobSnapshot?: unknown;
}) {
  return createHash("sha256")
    .update(
      stableSerialize({
        target: input.target,
        ruleSetId: input.ruleSetId,
        resumeSnapshotUpdatedAt: input.resumeSnapshotUpdatedAt,
        locale: input.locale ?? null,
        promptTemplateVersion: PROMPT_TEMPLATE_VERSION,
        schemaVersion: PROMPT_SCHEMA_VERSION,
        variant: input.variant ?? "legacy",
        prompt: input.prompt ?? null,
        effectiveRules: input.effectiveRules ?? null,
        resumeSnapshot: input.resumeSnapshot ?? null,
        jobSnapshot: input.jobSnapshot ?? null,
      }),
    )
    .digest("hex");
}

/**
 * Chains a post-generation transformation onto the prompt receipt that
 * produced its input. This keeps persisted provenance attached to the prompt
 * that produced the final accepted target, not only to the first draft.
 */
export function buildGenerationLineageHash(input: {
  target: PromptTarget;
  parentPromptHash: string;
  stage: "cover_quality_rewrite" | "independent_review";
  prompt: {
    instructions: string;
    input: string;
  };
}) {
  return createHash("sha256")
    .update(
      stableSerialize({
        target: input.target,
        parentPromptHash: input.parentPromptHash,
        stage: input.stage,
        promptTemplateVersion: PROMPT_TEMPLATE_VERSION,
        schemaVersion: PROMPT_SCHEMA_VERSION,
        prompt: input.prompt,
      }),
    )
    .digest("hex");
}

export function buildSkillPackVersion(input: {
  ruleSetId: string;
  resumeSnapshotUpdatedAt: string;
  locale?: string;
  effectiveRules?: unknown;
  resumeSnapshot?: unknown;
}) {
  return createHash("sha256")
    .update(
      stableSerialize({
        ruleSetId: input.ruleSetId,
        resumeSnapshotUpdatedAt: input.resumeSnapshotUpdatedAt,
        locale: input.locale ?? null,
        promptTemplateVersion: PROMPT_TEMPLATE_VERSION,
        schemaVersion: PROMPT_SCHEMA_VERSION,
        effectiveRules: input.effectiveRules ?? null,
        resumeSnapshot: input.resumeSnapshot ?? null,
      }),
    )
    .digest("hex");
}

export function buildPromptMeta(input: {
  target: ExtendedPromptTarget;
  ruleSetId: string;
  resumeSnapshotUpdatedAt: string;
  locale?: string;
  variant?: PromptVariant;
  prompt?: {
    instructions: string;
    input: string;
  };
  effectiveRules?: unknown;
  resumeSnapshot?: unknown;
  jobSnapshot?: unknown;
}): PromptMeta {
  return {
    ruleSetId: input.ruleSetId,
    resumeSnapshotUpdatedAt: input.resumeSnapshotUpdatedAt,
    promptTemplateVersion: PROMPT_TEMPLATE_VERSION,
    schemaVersion: PROMPT_SCHEMA_VERSION,
    skillPackVersion: buildSkillPackVersion(input),
    promptHash: buildPromptContentHash(input),
  };
}

export function validatePromptMetaForImport(input: {
  expected: PromptMeta;
  received: ImportedPromptMeta;
}):
  | { ok: true }
  | {
      ok: false;
      mismatches: PromptMetaMismatch[];
      expected: PromptMeta;
      received: ImportedPromptMeta;
    } {
  const mismatches: PromptMetaMismatch[] = [];
  const compareRequired = (field: "ruleSetId" | "resumeSnapshotUpdatedAt") => {
    if (input.received[field] !== input.expected[field]) {
      mismatches.push({
        field,
        expected: input.expected[field],
        received: input.received[field],
      });
    }
  };
  const compareOptional = (
    field: "promptTemplateVersion" | "schemaVersion" | "skillPackVersion" | "promptHash",
  ) => {
    const received = input.received[field];
    if (received && received !== input.expected[field]) {
      mismatches.push({
        field,
        expected: input.expected[field],
        received,
      });
    }
  };

  compareRequired("ruleSetId");
  compareRequired("resumeSnapshotUpdatedAt");
  compareOptional("promptTemplateVersion");
  compareOptional("schemaVersion");
  compareOptional("skillPackVersion");
  compareOptional("promptHash");

  if (mismatches.length === 0) return { ok: true };
  return {
    ok: false,
    mismatches,
    expected: input.expected,
    received: input.received,
  };
}
