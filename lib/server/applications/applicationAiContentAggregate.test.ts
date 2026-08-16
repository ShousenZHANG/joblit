import { describe, expect, it } from "vitest";
import {
  AI_CONTENT_SCHEMA_VERSION,
  aiContentSchema,
  type AiContent,
} from "@/lib/shared/schemas/aiContent";
import { evolveApplicationAiContent } from "./applicationAiContentAggregate";

function makeContent(label: string): AiContent {
  const generatedAt =
    label === "existing"
      ? "2026-07-20T00:00:00.000Z"
      : "2026-07-21T00:00:00.000Z";
  return {
    schemaVersion: AI_CONTENT_SCHEMA_VERSION,
    generatedAt,
    promptMetaHash: `${label}-prompt`,
    source: "manual_import",
    provenance: {
      resume: {
        generatedAt,
        promptMetaHash: `${label}-resume-prompt`,
        source: "manual_import",
      },
      cover: {
        generatedAt,
        promptMetaHash: `${label}-cover-prompt`,
        source: "manual_import",
      },
    },
    cv: {
      summary: {
        aiText: `${label} summary: built reliable TypeScript services.`,
        originalText: "Backend engineer.",
        accepted: true,
      },
      skillsSelection: {
        aiSelection: [
          { group: 0, items: [0, 1] },
          { group: 1, items: [0] },
        ],
      },
    },
    cover: {
      paragraphOne: { aiText: `${label} cover one`, accepted: true },
      paragraphTwo: { aiText: "I use TypeScript.", accepted: true },
      paragraphThree: { aiText: "I value quality.", accepted: true },
    },
  };
}

describe("evolveApplicationAiContent", () => {
  describe("replace_target_proposal", () => {
    it("replaces the resume while preserving the cover half and its provenance", () => {
      const existing = makeContent("existing");
      const incoming = makeContent("incoming");

      const result = evolveApplicationAiContent({
        current: existing,
        command: {
          kind: "replace_target_proposal",
          target: "resume",
          proposal: incoming,
        },
      });

      expect(result.cv.summary.aiText).toBe(incoming.cv.summary.aiText);
      expect(result.cover.paragraphOne.aiText).toBe(
        existing.cover.paragraphOne.aiText,
      );
      expect(result.provenance?.resume).toEqual(incoming.provenance?.resume);
      expect(result.provenance?.cover).toEqual(existing.provenance?.cover);
    });

    it("replaces the cover while preserving the resume half and its provenance", () => {
      // A cover import that silently rewrote the resume would invalidate the
      // PDF already published against it.
      const existing = makeContent("existing");
      const incoming = makeContent("incoming");

      const result = evolveApplicationAiContent({
        current: existing,
        command: {
          kind: "replace_target_proposal",
          target: "cover",
          proposal: incoming,
        },
      });

      expect(result.cv.summary.aiText).toBe(existing.cv.summary.aiText);
      expect(result.cover.paragraphOne.aiText).toBe(
        incoming.cover.paragraphOne.aiText,
      );
      expect(result.provenance?.resume).toEqual(existing.provenance?.resume);
      expect(result.provenance?.cover).toEqual(incoming.provenance?.cover);
    });

    it("carries the preserved target's skills selection through a cover replacement", () => {
      const existing = makeContent("existing");
      existing.cv.skillsSelection = {
        aiSelection: [{ group: 2, items: [1] }],
        userSelection: [{ group: 2, items: [1, 0] }],
      };
      const incoming = makeContent("incoming");

      const result = evolveApplicationAiContent({
        current: existing,
        command: {
          kind: "replace_target_proposal",
          target: "cover",
          proposal: incoming,
        },
      });

      expect(result.cv.skillsSelection).toEqual(existing.cv.skillsSelection);
    });

    it("replaces the skills selection wholesale when the resume is regenerated", () => {
      const existing = makeContent("existing");
      existing.cv.skillsSelection = {
        aiSelection: [{ group: 0, items: [0] }],
        userSelection: [{ group: 0, items: [0] }],
      };
      const incoming = makeContent("incoming");

      const result = evolveApplicationAiContent({
        current: existing,
        command: {
          kind: "replace_target_proposal",
          target: "resume",
          proposal: incoming,
        },
      });

      expect(result.cv.skillsSelection).toEqual(incoming.cv.skillsSelection);
      expect(result.cv.skillsSelection?.userSelection).toBeUndefined();
    });

    it("takes the whole proposal when there is no stored content yet", () => {
      const incoming = makeContent("incoming");

      const result = evolveApplicationAiContent({
        current: null,
        command: {
          kind: "replace_target_proposal",
          target: "cover",
          proposal: incoming,
        },
      });

      expect(result.cv).toEqual(incoming.cv);
      expect(result.cover).toEqual(incoming.cover);
    });

    it("does not invent provenance for a preserved legacy target", () => {
      const existing = makeContent("existing");
      delete existing.provenance;
      const incoming = makeContent("incoming");

      const result = evolveApplicationAiContent({
        current: existing,
        command: {
          kind: "replace_target_proposal",
          target: "cover",
          proposal: incoming,
        },
      });

      expect(result.provenance?.resume).toBeUndefined();
      expect(result.provenance?.cover).toEqual(incoming.provenance?.cover);
    });

    it("does not reinterpret legacy root metadata as target provenance", () => {
      const existing = makeContent("existing");
      const incoming = makeContent("incoming");
      delete incoming.provenance;

      const result = evolveApplicationAiContent({
        current: existing,
        command: {
          kind: "replace_target_proposal",
          target: "resume",
          proposal: incoming,
        },
      });

      expect(result.provenance?.resume).toBeUndefined();
      expect(result.provenance?.cover).toEqual(existing.provenance?.cover);
    });
  });

  describe("apply_client_edits", () => {
    it("keeps server-owned provenance and generation metadata", () => {
      const current = makeContent("existing");
      const submitted = structuredClone(current);
      submitted.generatedAt = "2026-07-22T00:00:00.000Z";
      submitted.promptMetaHash = "forged-root";
      submitted.provenance = {
        resume: {
          generatedAt: "2026-07-22T00:00:00.000Z",
          promptMetaHash: "forged-resume",
          source: "manual_import",
        },
      };
      submitted.cv.summary.userEdit = "User-approved wording.";

      const result = evolveApplicationAiContent({
        current,
        command: { kind: "apply_client_edits", submitted },
      });

      expect(result.generatedAt).toBe(current.generatedAt);
      expect(result.promptMetaHash).toBe(current.promptMetaHash);
      expect(result.provenance).toEqual(current.provenance);
      expect(result.cv.summary.userEdit).toBe("User-approved wording.");
    });

    it("rebuilds the summary's server-owned text from the canonical row", () => {
      const current = makeContent("existing");
      const submitted = structuredClone(current);
      submitted.cv.summary.aiText = "forged AI text";
      submitted.cv.summary.originalText = "forged original";
      submitted.cover.paragraphTwo.aiText = "forged paragraph";

      const result = evolveApplicationAiContent({
        current,
        command: { kind: "apply_client_edits", submitted },
      });

      expect(result.cv.summary.aiText).toBe(current.cv.summary.aiText);
      expect(result.cv.summary.originalText).toBe(
        current.cv.summary.originalText,
      );
      expect(result.cover.paragraphTwo.aiText).toBe(
        current.cover.paragraphTwo.aiText,
      );
    });

    it("accepts a submitted userSelection and preserves the server-owned aiSelection", () => {
      const current = makeContent("existing");
      const submitted = structuredClone(current);
      submitted.cv.skillsSelection = {
        // The browser may not rewrite what the generation recorded.
        aiSelection: [{ group: 5, items: [4] }],
        userSelection: [{ group: 1, items: [0] }],
      };

      const result = evolveApplicationAiContent({
        current,
        command: { kind: "apply_client_edits", submitted },
      });

      expect(result.cv.skillsSelection?.aiSelection).toEqual(
        current.cv.skillsSelection?.aiSelection,
      );
      expect(result.cv.skillsSelection?.userSelection).toEqual([
        { group: 1, items: [0] },
      ]);
    });

    it("clears a prior override when the browser submits none", () => {
      // The browser posts the whole aggregate, so an absent userSelection is
      // the user having reset back to the AI's own selection — not a partial
      // patch that should leave the old override standing.
      const current = makeContent("existing");
      current.cv.skillsSelection = {
        aiSelection: [{ group: 0, items: [0, 1] }],
        userSelection: [{ group: 0, items: [1] }],
      };
      const submitted = structuredClone(current);
      delete submitted.cv.skillsSelection?.userSelection;

      const result = evolveApplicationAiContent({
        current,
        command: { kind: "apply_client_edits", submitted },
      });

      expect(result.cv.skillsSelection).toEqual({
        aiSelection: [{ group: 0, items: [0, 1] }],
      });
    });

    it("cannot introduce a skills selection onto a row that has none", () => {
      // A legacy draft renders the master profile's skills as they are. A
      // forged body must not be able to turn that into a tailored selection.
      const current = makeContent("existing");
      delete current.cv.skillsSelection;
      const submitted = structuredClone(current);
      submitted.cv.skillsSelection = {
        aiSelection: [{ group: 0, items: [0] }],
        userSelection: [{ group: 0, items: [0] }],
      };

      const result = evolveApplicationAiContent({
        current,
        command: { kind: "apply_client_edits", submitted },
      });

      expect(result.cv.skillsSelection).toBeUndefined();
    });
  });

  describe("discard_edits", () => {
    it("drops the summary's user edit and restores acceptance", () => {
      const current = makeContent("existing");
      current.cv.summary.userEdit = "Edited wording.";
      current.cv.summary.accepted = false;
      current.cover.paragraphOne.userEdit = "Edited paragraph.";
      current.cover.paragraphOne.accepted = false;

      const result = evolveApplicationAiContent({
        current,
        command: { kind: "discard_edits" },
      });

      expect(result.cv.summary.userEdit).toBeUndefined();
      expect(result.cv.summary.accepted).toBe(true);
      expect(result.cv.summary.aiText).toBe(current.cv.summary.aiText);
      expect(result.cover.paragraphOne.userEdit).toBeUndefined();
      expect(result.cover.paragraphOne.accepted).toBe(true);
    });

    it("drops the userSelection and restores the AI's own selection", () => {
      const current = makeContent("existing");
      current.cv.skillsSelection = {
        aiSelection: [
          { group: 0, items: [0, 1] },
          { group: 1, items: [0] },
        ],
        userSelection: [{ group: 1, items: [0] }],
      };

      const result = evolveApplicationAiContent({
        current,
        command: { kind: "discard_edits" },
      });

      expect(result.cv.skillsSelection).toEqual({
        aiSelection: [
          { group: 0, items: [0, 1] },
          { group: 1, items: [0] },
        ],
      });
      expect(result.cv.skillsSelection?.userSelection).toBeUndefined();
    });

    it("leaves a row with no selection without one", () => {
      const current = makeContent("existing");
      delete current.cv.skillsSelection;

      const result = evolveApplicationAiContent({
        current,
        command: { kind: "discard_edits" },
      });

      expect(result.cv.skillsSelection).toBeUndefined();
    });
  });

  it("fails closed when a non-proposal command arrives with no stored content", () => {
    expect(() =>
      evolveApplicationAiContent({
        // An untyped JavaScript caller can reach this; it must not manufacture
        // an invalid aggregate.
        current: null as unknown as AiContent,
        command: { kind: "discard_edits" },
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "APPLICATION_AI_CONTENT_CURRENT_REQUIRED",
      }),
    );
  });
});

describe("aiContent v1 rows read back as v2", () => {
  const v1Row = {
    schemaVersion: 1,
    generatedAt: "2026-06-01T00:00:00.000Z",
    promptMetaHash: "legacy-prompt",
    source: "manual_import",
    evidence: [
      {
        id: `ev_${"a".repeat(32)}`,
        kind: "candidate",
        path: "resume.summary",
        contentHash: "a".repeat(64),
        excerpt: "Built reliable TypeScript services.",
      },
    ],
    review: {
      verdict: "blocked",
      reviewedAt: "2026-06-01T00:10:00.000Z",
      coveragePercent: 40,
      requirements: [],
      issues: ["stale review"],
    },
    cv: {
      summary: {
        aiText: "Backend Engineer shipping reliable TypeScript services.",
        originalText: "Backend engineer.",
        accepted: true,
        evidenceIds: [`ev_${"a".repeat(32)}`],
      },
      latestExperience: {
        experienceIndex: 0,
        addedBullets: [
          {
            text: "Built reliable TypeScript services.",
            accepted: true,
            qualityGate: { passed: true },
            evidenceIds: [`ev_${"a".repeat(32)}`],
          },
        ],
      },
    },
    cover: {
      paragraphOne: {
        aiText: "One",
        accepted: true,
        evidenceIds: [`ev_${"a".repeat(32)}`],
      },
      paragraphTwo: { aiText: "Two", accepted: true, evidenceIds: [] },
      paragraphThree: { aiText: "Three", accepted: true, evidenceIds: [] },
    },
  };

  it("parses clean with the ledger, the bullets and the evidence pointers gone", () => {
    const parsed = aiContentSchema.parse(v1Row);

    expect(parsed.schemaVersion).toBe(AI_CONTENT_SCHEMA_VERSION);
    expect(parsed).not.toHaveProperty("evidence");
    expect(parsed).not.toHaveProperty("review");
    expect(parsed.cv).not.toHaveProperty("latestExperience");
    expect(parsed.cv.summary).not.toHaveProperty("evidenceIds");
    expect(parsed.cover.paragraphOne).not.toHaveProperty("evidenceIds");
  });

  it("keeps the summary and the cover letter the row already rendered", () => {
    const parsed = aiContentSchema.parse(v1Row);

    expect(parsed.cv.summary).toEqual({
      aiText: "Backend Engineer shipping reliable TypeScript services.",
      originalText: "Backend engineer.",
      accepted: true,
    });
    expect(parsed.cover.paragraphTwo.aiText).toBe("Two");
  });

  it("invents no skills selection, so the row keeps rendering profile skills", () => {
    expect(aiContentSchema.parse(v1Row).cv.skillsSelection).toBeUndefined();
  });

  it("still refuses an unknown key on a v2 row", () => {
    // The retired keys are dropped by name. Everything else stays strict: an
    // unknown key is a client smuggling server-owned state.
    const forged = { ...makeContent("existing"), attackerOwned: true };
    expect(aiContentSchema.safeParse(forged).success).toBe(false);
  });
});
