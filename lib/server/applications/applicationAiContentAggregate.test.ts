import { describe, expect, it } from "vitest";
import { attachEvidenceAndReview } from "@/lib/server/ai/evidenceLedger";
import {
  AI_CONTENT_SCHEMA_VERSION,
  type AiContent,
} from "@/lib/shared/schemas/aiContent";
import { evolveApplicationAiContent } from "./applicationAiContentAggregate";

const REVIEW_CONTEXT = {
  scopeKey: "tenant-1",
  resumeSnapshot: {
    summary: "Built reliable TypeScript services.",
    skills: [{ label: "Languages", items: ["TypeScript"] }],
  },
  jobDescription: "Build reliable TypeScript services.",
  jobSourceAvailable: true,
};

function makeContent(label: string): AiContent {
  const generatedAt =
    label === "existing"
      ? "2026-07-20T00:00:00.000Z"
      : "2026-07-21T00:00:00.000Z";
  return attachEvidenceAndReview({
    scopeKey: REVIEW_CONTEXT.scopeKey,
    resumeSnapshot: REVIEW_CONTEXT.resumeSnapshot,
    jobDescription: REVIEW_CONTEXT.jobDescription,
    aiContent: {
      schemaVersion: AI_CONTENT_SCHEMA_VERSION,
      generatedAt,
      promptMetaHash: `${label}-prompt`,
      source: "local_ai",
      provenance: {
        resume: {
          generatedAt,
          promptMetaHash: `${label}-resume-prompt`,
          source: "local_ai",
        },
        cover: {
          generatedAt,
          promptMetaHash: `${label}-cover-prompt`,
          source: "local_ai",
        },
      },
      cv: {
        summary: {
          aiText: "Built reliable TypeScript services.",
          originalText: "Backend engineer.",
          accepted: true,
        },
        latestExperience: {
          experienceIndex: 0,
          addedBullets: [
            {
              text: "Built reliable TypeScript services.",
              accepted: true,
              qualityGate: { passed: true },
            },
          ],
        },
      },
      cover: {
        paragraphOne: {
          aiText: `${label} cover one`,
          accepted: true,
        },
        paragraphTwo: {
          aiText: "I use TypeScript.",
          accepted: true,
        },
        paragraphThree: {
          aiText: "I value quality.",
          accepted: true,
        },
      },
    },
  });
}

describe("evolveApplicationAiContent", () => {
  it("replaces one target while preserving the other target provenance", () => {
    const existing = makeContent("existing");
    const incoming = makeContent("incoming");

    const result = evolveApplicationAiContent({
      current: existing,
      command: {
        kind: "replace_target_proposal",
        target: "resume",
        proposal: incoming,
      },
      reviewContext: REVIEW_CONTEXT,
    });

    expect(result.kind).toBe("evolved");
    if (result.kind !== "evolved") return;
    expect(result.aiContent.cv).toEqual(
      expect.objectContaining({
        summary: expect.objectContaining({ aiText: incoming.cv.summary.aiText }),
      }),
    );
    expect(result.aiContent.cover.paragraphOne.aiText).toBe(
      existing.cover.paragraphOne.aiText,
    );
    expect(result.aiContent.provenance?.resume).toEqual(
      incoming.provenance?.resume,
    );
    expect(result.aiContent.provenance?.cover).toEqual(
      existing.provenance?.cover,
    );
  });

  it("replaces the cover while preserving resume content and provenance", () => {
    const existing = makeContent("existing");
    const incoming = makeContent("incoming");

    const result = evolveApplicationAiContent({
      current: existing,
      command: {
        kind: "replace_target_proposal",
        target: "cover",
        proposal: incoming,
      },
      reviewContext: REVIEW_CONTEXT,
    });

    expect(result.kind).toBe("evolved");
    if (result.kind !== "evolved") return;
    expect(result.aiContent.cv.summary.aiText).toBe(
      existing.cv.summary.aiText,
    );
    expect(result.aiContent.cover.paragraphOne.aiText).toBe(
      incoming.cover.paragraphOne.aiText,
    );
    expect(result.aiContent.provenance?.resume).toEqual(
      existing.provenance?.resume,
    );
    expect(result.aiContent.provenance?.cover).toEqual(
      incoming.provenance?.cover,
    );
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
      reviewContext: REVIEW_CONTEXT,
    });

    expect(result.kind).toBe("evolved");
    if (result.kind !== "evolved") return;
    expect(result.aiContent.provenance?.resume).toBeUndefined();
    expect(result.aiContent.provenance?.cover).toEqual(
      incoming.provenance?.cover,
    );
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
      reviewContext: REVIEW_CONTEXT,
    });

    expect(result.kind).toBe("evolved");
    if (result.kind !== "evolved") return;
    expect(result.aiContent.provenance?.resume).toBeUndefined();
    expect(result.aiContent.provenance?.cover).toEqual(
      existing.provenance?.cover,
    );
  });

  it("re-reviews the full aggregate after a target replacement", () => {
    const existing = makeContent("existing");
    existing.cover.paragraphOne.aiText =
      "I increased revenue by 999% without supporting evidence.";
    const incoming = makeContent("incoming");

    const result = evolveApplicationAiContent({
      current: existing,
      command: {
        kind: "replace_target_proposal",
        target: "resume",
        proposal: incoming,
      },
      reviewContext: REVIEW_CONTEXT,
    });

    expect(result.kind).toBe("evolved");
    if (result.kind !== "evolved") return;
    expect(result.aiContent.review?.verdict).toBe("blocked");
    expect(result.aiContent.review?.issues.join(" ")).toContain("999%");
    expect(result.aiContent.cover.paragraphOne.evidenceIds).toBeDefined();
  });

  it("keeps server-owned provenance when applying client edits", () => {
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
    submitted.cv.latestExperience.addedBullets[0]!.evidenceIds = [
      `ev_${"f".repeat(32)}`,
    ];
    submitted.evidence = [
      {
        id: `ev_${"f".repeat(32)}`,
        kind: "candidate",
        path: "resume.forged",
        contentHash: "f".repeat(64),
        excerpt: "forged evidence",
      },
    ];
    submitted.review = {
      verdict: "pass",
      reviewedAt: "2026-07-22T00:00:00.000Z",
      coveragePercent: 100,
      requirements: [],
      issues: [],
    };

    const result = evolveApplicationAiContent({
      current,
      command: { kind: "apply_client_edits", submitted },
      reviewContext: REVIEW_CONTEXT,
    });

    expect(result.kind).toBe("evolved");
    if (result.kind !== "evolved") return;
    expect(result.aiContent.generatedAt).toBe(current.generatedAt);
    expect(result.aiContent.promptMetaHash).toBe(current.promptMetaHash);
    expect(result.aiContent.provenance).toEqual(current.provenance);
    expect(result.aiContent.cv.summary.userEdit).toBe(
      "User-approved wording.",
    );
    expect(result.aiContent.evidence).not.toEqual(submitted.evidence);
    expect(
      result.aiContent.cv.latestExperience.addedBullets[0]?.evidenceIds,
    ).not.toContain(`ev_${"f".repeat(32)}`);
  });

  it("rebuilds evidence and review after discarding edits", () => {
    const current = makeContent("existing");
    current.cv.summary.userEdit = "Built reliable TypeScript services.";
    current.cv.summary.evidenceIds = [];
    current.review = {
      verdict: "blocked",
      reviewedAt: "2026-07-20T12:00:00.000Z",
      coveragePercent: 0,
      requirements: [],
      issues: ["stale review"],
    };

    const result = evolveApplicationAiContent({
      current,
      command: { kind: "discard_edits" },
      reviewContext: REVIEW_CONTEXT,
    });

    expect(result.kind).toBe("evolved");
    if (result.kind !== "evolved") return;
    expect(result.aiContent.cv.summary.userEdit).toBeUndefined();
    expect(result.aiContent.cv.summary.evidenceIds?.length).toBeGreaterThan(0);
    expect(result.aiContent.review?.issues).not.toContain("stale review");
  });

  it("reviews a legacy aggregate even when it has no prior evidence metadata", () => {
    const current = makeContent("existing");
    delete current.evidence;
    delete current.review;
    delete current.cv.summary.evidenceIds;
    current.cv.latestExperience.addedBullets.forEach((bullet) => {
      delete bullet.evidenceIds;
    });
    delete current.cover.paragraphOne.evidenceIds;
    delete current.cover.paragraphTwo.evidenceIds;
    delete current.cover.paragraphThree.evidenceIds;
    current.cover.paragraphOne.aiText =
      "I increased revenue by 999% without supporting evidence.";

    const result = evolveApplicationAiContent({
      current,
      command: { kind: "refresh_review" },
      reviewContext: REVIEW_CONTEXT,
    });

    expect(result.kind).toBe("evolved");
    if (result.kind !== "evolved") return;
    expect(result.aiContent.review?.verdict).toBe("blocked");
    expect(result.aiContent.review?.issues.join(" ")).toContain("999%");
  });

  it("preserves reviewedAt only when evidence and review are unchanged", () => {
    const current = makeContent("existing");
    const reviewedAt = current.review?.reviewedAt;

    const unchanged = evolveApplicationAiContent({
      current,
      command: { kind: "refresh_review", preserveReviewedAt: true },
      reviewContext: REVIEW_CONTEXT,
    });

    expect(unchanged.kind).toBe("evolved");
    if (unchanged.kind !== "evolved") return;
    expect(unchanged.aiContent.review?.reviewedAt).toBe(reviewedAt);

    current.review = current.review
      ? {
          ...current.review,
          reviewedAt: "2026-07-20T12:00:00.000Z",
        }
      : undefined;
    const changed = evolveApplicationAiContent({
      current,
      command: { kind: "refresh_review", preserveReviewedAt: true },
      reviewContext: {
        ...REVIEW_CONTEXT,
        jobDescription: "Lead a Kubernetes migration for 200 services.",
      },
    });

    expect(changed.kind).toBe("evolved");
    if (changed.kind !== "evolved") return;
    expect(changed.aiContent.review?.reviewedAt).not.toBe(
      "2026-07-20T12:00:00.000Z",
    );
  });

  it("refreshes reviewedAt when claim evidence assignments changed", () => {
    const current = makeContent("existing");
    current.cv.summary.evidenceIds = [];
    current.review = current.review
      ? {
          ...current.review,
          reviewedAt: "2026-07-20T12:00:00.000Z",
        }
      : undefined;

    const result = evolveApplicationAiContent({
      current,
      command: { kind: "refresh_review", preserveReviewedAt: true },
      reviewContext: REVIEW_CONTEXT,
    });

    expect(result.kind).toBe("evolved");
    if (result.kind !== "evolved") return;
    expect(result.aiContent.cv.summary.evidenceIds?.length).toBeGreaterThan(0);
    expect(result.aiContent.review?.reviewedAt).not.toBe(
      "2026-07-20T12:00:00.000Z",
    );
  });

  it("fails closed when canonical review sources are unavailable", () => {
    const current = makeContent("existing");

    const result = evolveApplicationAiContent({
      current,
      command: {
        kind: "apply_client_edits",
        submitted: structuredClone(current),
      },
    });

    expect(result).toEqual({ kind: "review_context_required" });
  });

  it("fails closed when the Job source is unavailable", () => {
    const current = makeContent("existing");

    const result = evolveApplicationAiContent({
      current,
      command: { kind: "discard_edits" },
      reviewContext: {
        ...REVIEW_CONTEXT,
        jobDescription: undefined,
        jobSourceAvailable: false,
      },
    });

    expect(result).toEqual({ kind: "review_context_required" });
  });
});

/**
 * The production state nothing covered: a COVER draft imported onto an
 * Application whose RESUME has already been accepted and published. Every
 * existing case here merges into a fresh or same-target aggregate.
 *
 * The evidence array is rebuilt from scratch on that second merge, and the
 * commit then re-validates it through assertCanonicalEvidenceReferences. If
 * those two disagree by a single byte, the validator throws a bare Error from
 * inside the commit transaction, which reaches an agent client as an anonymous
 * 500 and is replayed until the batch parks.
 */
describe("merging cover onto an already-published resume", () => {
  const LONG_JD = `${"deliver reliable typescript services ".repeat(40)}end.`;

  it("produces evidence that still passes canonical validation", async () => {
    const { assertCanonicalEvidenceReferences } = await import(
      "@/lib/server/ai/evidenceLedger"
    );
    const context = { ...REVIEW_CONTEXT, jobDescription: LONG_JD };
    const published = attachEvidenceAndReview({
      scopeKey: context.scopeKey,
      resumeSnapshot: context.resumeSnapshot,
      jobDescription: context.jobDescription,
      aiContent: makeContent("existing"),
    });

    const evolved = evolveApplicationAiContent({
      current: published,
      command: {
        kind: "replace_target_proposal",
        target: "cover",
        proposal: makeContent("incoming"),
      },
      reviewContext: context,
    });

    expect(evolved.kind).toBe("evolved");
    const merged = evolved.kind === "evolved" ? evolved.aiContent : null;
    expect(merged?.evidence?.length).toBeGreaterThan(0);
    expect(() =>
      assertCanonicalEvidenceReferences(context.scopeKey, merged?.evidence ?? []),
    ).not.toThrow();
  });

  it("keeps the published resume half untouched", () => {
    // A cover import that silently rewrote the resume would invalidate the PDF
    // already published against it.
    const published = makeContent("existing");
    const evolved = evolveApplicationAiContent({
      current: published,
      command: {
        kind: "replace_target_proposal",
        target: "cover",
        proposal: makeContent("incoming"),
      },
      reviewContext: REVIEW_CONTEXT,
    });

    expect(evolved.kind).toBe("evolved");
    if (evolved.kind !== "evolved") return;
    expect(evolved.aiContent.cv.summary.aiText).toBe(
      published.cv.summary.aiText,
    );
    expect(evolved.aiContent.provenance?.resume).toEqual(
      published.provenance?.resume,
    );
  });
});
