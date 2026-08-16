import { describe, expect, it } from "vitest";
import {
  PROMPT_SCHEMA_VERSION,
  PROMPT_TEMPLATE_VERSION,
  buildGenerationLineageHash,
  buildPromptMeta,
  buildSkillPackVersion,
  getExpectedJsonSchemaForTarget,
  getExpectedJsonShapeForTarget,
  validatePromptMetaForImport,
} from "./promptContract";

describe("prompt contract", () => {
  const expected = buildPromptMeta({
    target: "resume",
    ruleSetId: "rules-1",
    resumeSnapshotUpdatedAt: "2026-02-22T10:00:00.000Z",
    variant: "full",
    prompt: {
      instructions: "Use only grounded evidence.",
      input: "Tailor this resume for job one.",
    },
  });

  it("publishes the current summary-and-selection resume contract and paragraph-only cover contract", () => {
    // A contract that changed shape must not validate against old receipts.
    expect(PROMPT_TEMPLATE_VERSION).not.toBe("2026.02.v1");
    expect(PROMPT_TEMPLATE_VERSION).not.toBe("2026.07.v2");
    expect(PROMPT_SCHEMA_VERSION).not.toBe("2026-02-22");
    expect(PROMPT_SCHEMA_VERSION).not.toBe("2026-07-24");
    expect(getExpectedJsonShapeForTarget("resume")).toEqual({
      cvSummary: "string",
      skillsSelection: [{ group: "number", items: ["number"] }],
    });
    expect(getExpectedJsonSchemaForTarget("resume")).toMatchObject({
      additionalProperties: false,
      required: ["cvSummary", "skillsSelection"],
      properties: {
        cvSummary: { type: "string", minLength: 120, maxLength: 350 },
        skillsSelection: {
          type: "array",
          minItems: 1,
          maxItems: 12,
          items: {
            additionalProperties: false,
            required: ["group", "items"],
            properties: {
              group: { type: "integer", minimum: 0, maximum: 11 },
              items: {
                type: "array",
                minItems: 1,
                maxItems: 30,
                items: { type: "integer", minimum: 0, maximum: 29 },
              },
            },
          },
        },
      },
    });
    expect(JSON.stringify(getExpectedJsonSchemaForTarget("resume"))).not.toMatch(
      /skillsFinal|skillsAdditions|latestExperience|addedBullets|"\s*bullets\s*"/,
    );

    expect(getExpectedJsonShapeForTarget("cover")).toEqual({
      cover: {
        paragraphOne: "string",
        paragraphTwo: "string",
        paragraphThree: "string",
      },
    });
    expect(getExpectedJsonSchemaForTarget("cover")).toMatchObject({
      properties: {
        cover: {
          additionalProperties: false,
          required: ["paragraphOne", "paragraphTwo", "paragraphThree"],
          properties: {
            paragraphOne: expect.any(Object),
            paragraphTwo: expect.any(Object),
            paragraphThree: expect.any(Object),
          },
        },
      },
    });
    expect(
      Object.keys(
        getExpectedJsonSchemaForTarget("cover").properties?.cover?.properties ??
          {},
      ),
    ).toEqual(["paragraphOne", "paragraphTwo", "paragraphThree"]);
  });

  it("hashes the actual prompt bytes and variant", () => {
    const base = {
      target: "resume" as const,
      ruleSetId: "rules-1",
      resumeSnapshotUpdatedAt: "2026-02-22T10:00:00.000Z",
      variant: "full" as const,
      prompt: {
        instructions: "Use only grounded evidence.",
        input: "Tailor this resume for job one.",
      },
    };

    const same = buildPromptMeta(base);
    const changedJob = buildPromptMeta({
      ...base,
      prompt: { ...base.prompt, input: "Tailor this resume for job two." },
    });
    const changedRules = buildPromptMeta({
      ...base,
      prompt: {
        ...base.prompt,
        instructions: "Use only grounded evidence. Prefer concise writing.",
      },
    });
    const lean = buildPromptMeta({ ...base, variant: "lean" });
    const changedEffectiveRules = buildPromptMeta({
      ...base,
      effectiveRules: { cvRules: ["Prefer concise writing."] },
    });
    const changedResumeSnapshot = buildPromptMeta({
      ...base,
      resumeSnapshot: { summary: "A different candidate snapshot." },
    });
    const changedJobSnapshot = buildPromptMeta({
      ...base,
      jobSnapshot: { description: "A different job snapshot." },
    });

    expect(buildPromptMeta(base).promptHash).toBe(same.promptHash);
    expect(changedJob.promptHash).not.toBe(same.promptHash);
    expect(changedRules.promptHash).not.toBe(same.promptHash);
    expect(lean.promptHash).not.toBe(same.promptHash);
    expect(changedEffectiveRules.promptHash).not.toBe(same.promptHash);
    expect(changedResumeSnapshot.promptHash).not.toBe(same.promptHash);
    expect(changedJobSnapshot.promptHash).not.toBe(same.promptHash);
  });

  it("chains post-generation prompts to the parent target receipt", () => {
    const base = {
      target: "resume" as const,
      parentPromptHash: "primary-resume",
      stage: "independent_review" as const,
      prompt: {
        instructions: "Review independently.",
        input: "Review draft A.",
      },
    };

    const same = buildGenerationLineageHash(base);
    expect(buildGenerationLineageHash(base)).toBe(same);
    expect(
      buildGenerationLineageHash({
        ...base,
        parentPromptHash: "different-primary",
      }),
    ).not.toBe(same);
    expect(
      buildGenerationLineageHash({
        ...base,
        prompt: { ...base.prompt, input: "Review draft B." },
      }),
    ).not.toBe(same);
    expect(
      buildGenerationLineageHash({ ...base, target: "cover" }),
    ).not.toBe(same);
  });

  it("versions a skill pack from deterministic effective rules and resume bytes", () => {
    const base = {
      ruleSetId: "rules-1",
      resumeSnapshotUpdatedAt: "2026-02-22T10:00:00.000Z",
      locale: "en-AU",
      effectiveRules: {
        hardConstraints: ["Ground every claim."],
        cvRules: ["Return additions only."],
      },
      resumeSnapshot: {
        summary: "Backend engineer.",
        skills: ["TypeScript"],
      },
    };

    expect(buildSkillPackVersion(base)).toBe(
      buildSkillPackVersion({
        ...base,
        effectiveRules: {
          cvRules: ["Return additions only."],
          hardConstraints: ["Ground every claim."],
        },
      }),
    );
    expect(
      buildSkillPackVersion({
        ...base,
        effectiveRules: { ...base.effectiveRules, cvRules: ["Different rule."] },
      }),
    ).not.toBe(buildSkillPackVersion(base));
    expect(
      buildSkillPackVersion({
        ...base,
        resumeSnapshot: { ...base.resumeSnapshot, summary: "Changed." },
      }),
    ).not.toBe(buildSkillPackVersion(base));
    expect(
      buildSkillPackVersion({
        ...base,
        locale: "zh-CN",
      }),
    ).not.toBe(buildSkillPackVersion(base));
  });

  it("accepts legacy import metadata with only required fields", () => {
    const result = validatePromptMetaForImport({
      expected,
      received: {
        ruleSetId: expected.ruleSetId,
        resumeSnapshotUpdatedAt: expected.resumeSnapshotUpdatedAt,
      },
    });

    expect(result).toEqual({ ok: true });
  });

  it("accepts complete matching import metadata", () => {
    const result = validatePromptMetaForImport({
      expected,
      received: expected,
    });

    expect(result).toEqual({ ok: true });
  });

  it("returns field-level mismatches for stale prompt metadata", () => {
    const result = validatePromptMetaForImport({
      expected,
      received: {
        ruleSetId: "rules-2",
        resumeSnapshotUpdatedAt: expected.resumeSnapshotUpdatedAt,
        skillPackVersion: "stale-pack",
        promptHash: "stale-prompt",
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.mismatches).toEqual([
      { field: "ruleSetId", expected: expected.ruleSetId, received: "rules-2" },
      {
        field: "skillPackVersion",
        expected: expected.skillPackVersion,
        received: "stale-pack",
      },
      { field: "promptHash", expected: expected.promptHash, received: "stale-prompt" },
    ]);
    expect(result.expected).toBe(expected);
  });
});
