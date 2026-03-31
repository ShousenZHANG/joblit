import { createHash } from "node:crypto";

export type PromptTarget = "resume" | "cover";

export const PROMPT_TEMPLATE_VERSION = "2026.02.v1";
export const PROMPT_SCHEMA_VERSION = "2026-02-22";
export const SKILL_PACK_SEMANTIC_VERSION = "2.0.0";

export type PromptMeta = {
  ruleSetId: string;
  resumeSnapshotUpdatedAt: string;
  promptTemplateVersion: string;
  schemaVersion: string;
  skillPackVersion: string;
  promptHash: string;
};

const RESUME_OUTPUT_SHAPE = {
  cvSummary: "string",
  latestExperience: {
    bullets: ["string"],
  },
  skillsFinal: [
    {
      label: "string",
      items: ["string"],
    },
  ],
};

const COVER_OUTPUT_SHAPE = {
  cover: {
    candidateTitle: "string (optional)",
    subject: "string (optional)",
    date: "string (optional)",
    salutation: "string (optional)",
    paragraphOne: "string",
    paragraphTwo: "string",
    paragraphThree: "string",
    closing: "string (optional)",
    signatureName: "string (optional)",
  },
};

const RESUME_OUTPUT_JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["cvSummary", "latestExperience", "skillsFinal"],
  properties: {
    cvSummary: {
      type: "string",
      minLength: 1,
      maxLength: 2000,
    },
    latestExperience: {
      type: "object",
      additionalProperties: false,
      required: ["bullets"],
      properties: {
        bullets: {
          type: "array",
          minItems: 1,
          maxItems: 15,
          items: {
            type: "string",
            minLength: 1,
            maxLength: 320,
          },
        },
      },
    },
    skillsFinal: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "items"],
        properties: {
          label: {
            type: "string",
            minLength: 1,
            maxLength: 100,
          },
          items: {
            type: "array",
            minItems: 1,
            maxItems: 20,
            items: {
              type: "string",
              minLength: 1,
              maxLength: 120,
            },
          },
        },
      },
    },
  },
} as const;

const COVER_OUTPUT_JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["cover"],
  properties: {
    cover: {
      type: "object",
      additionalProperties: false,
      required: ["paragraphOne", "paragraphTwo", "paragraphThree"],
      properties: {
        candidateTitle: {
          type: "string",
          maxLength: 160,
        },
        subject: {
          type: "string",
          maxLength: 220,
        },
        date: {
          type: "string",
          maxLength: 80,
        },
        salutation: {
          type: "string",
          maxLength: 220,
        },
        paragraphOne: {
          type: "string",
          minLength: 1,
          maxLength: 2000,
        },
        paragraphTwo: {
          type: "string",
          minLength: 1,
          maxLength: 2000,
        },
        paragraphThree: {
          type: "string",
          minLength: 1,
          maxLength: 2000,
        },
        closing: {
          type: "string",
          maxLength: 300,
        },
        signatureName: {
          type: "string",
          maxLength: 120,
        },
      },
    },
  },
} as const;

export function getExpectedJsonShapeForTarget(target: PromptTarget) {
  return target === "resume" ? RESUME_OUTPUT_SHAPE : COVER_OUTPUT_SHAPE;
}

export function getExpectedJsonSchemaForTarget(target: PromptTarget) {
  return target === "resume" ? RESUME_OUTPUT_JSON_SCHEMA : COVER_OUTPUT_JSON_SCHEMA;
}

function buildPromptHash(input: {
  target: PromptTarget;
  ruleSetId: string;
  resumeSnapshotUpdatedAt: string;
}) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        target: input.target,
        ruleSetId: input.ruleSetId,
        resumeSnapshotUpdatedAt: input.resumeSnapshotUpdatedAt,
        promptTemplateVersion: PROMPT_TEMPLATE_VERSION,
        schemaVersion: PROMPT_SCHEMA_VERSION,
      }),
    )
    .digest("hex");
}

export function buildSkillPackVersion(input: {
  ruleSetId: string;
  resumeSnapshotUpdatedAt: string;
}) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        ruleSetId: input.ruleSetId,
        resumeSnapshotUpdatedAt: input.resumeSnapshotUpdatedAt,
        promptTemplateVersion: PROMPT_TEMPLATE_VERSION,
        schemaVersion: PROMPT_SCHEMA_VERSION,
      }),
    )
    .digest("hex");
}

export function buildPromptMeta(input: {
  target: PromptTarget;
  ruleSetId: string;
  resumeSnapshotUpdatedAt: string;
}): PromptMeta {
  return {
    ruleSetId: input.ruleSetId,
    resumeSnapshotUpdatedAt: input.resumeSnapshotUpdatedAt,
    promptTemplateVersion: PROMPT_TEMPLATE_VERSION,
    schemaVersion: PROMPT_SCHEMA_VERSION,
    skillPackVersion: buildSkillPackVersion(input),
    promptHash: buildPromptHash(input),
  };
}
