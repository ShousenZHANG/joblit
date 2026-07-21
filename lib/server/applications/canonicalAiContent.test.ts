import { describe, expect, it } from "vitest";
import { attachEvidenceAndReview } from "@/lib/server/ai/evidenceLedger";
import type { AiContent } from "@/lib/shared/schemas/aiContent";
import {
  mergeClientAiContentEdits,
  rebuildCanonicalAiContent,
} from "./canonicalAiContent";

function baseContent(): AiContent {
  return {
    schemaVersion: 1,
    generatedAt: "2026-07-20T00:00:00.000Z",
    promptMetaHash: "server-prompt",
    source: "local_ai",
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
      paragraphOne: { aiText: "I build reliable services.", accepted: true },
      paragraphTwo: { aiText: "I use TypeScript.", accepted: true },
      paragraphThree: { aiText: "I value quality.", accepted: true },
    },
  };
}

describe("mergeClientAiContentEdits", () => {
  it("keeps all provenance server-owned and applies only editable decisions", () => {
    const canonical = attachEvidenceAndReview({
      aiContent: baseContent(),
      resumeSnapshot: {
        summary: "Built reliable TypeScript services.",
      },
      jobDescription: "Build reliable TypeScript services.",
      scopeKey: "tenant-1",
    });
    const submitted = structuredClone(canonical);
    submitted.generatedAt = "2026-07-20T12:00:00.000Z";
    submitted.promptMetaHash = "attacker";
    submitted.cv.summary.aiText = "Increased revenue by 999%.";
    submitted.cv.summary.originalText = "forged";
    submitted.cv.summary.userEdit = "User-approved wording.";
    submitted.cv.latestExperience.addedBullets[0].text = "Forged bullet";
    submitted.cv.latestExperience.addedBullets[0].qualityGate = {
      passed: false,
      reason: "forged",
    };
    submitted.cv.latestExperience.addedBullets[0].accepted = false;
    submitted.evidence = [
      {
        id: `ev_${"1".repeat(32)}`,
        kind: "candidate",
        path: "resume.forged",
        contentHash: "a".repeat(64),
        excerpt: "improved revenue by 999%",
      },
    ];
    submitted.review = {
      verdict: "pass",
      reviewedAt: "2026-07-20T12:00:00.000Z",
      coveragePercent: 100,
      requirements: [],
      issues: [],
    };

    const merged = mergeClientAiContentEdits(canonical, submitted);

    expect(merged.generatedAt).toBe(canonical.generatedAt);
    expect(merged.promptMetaHash).toBe(canonical.promptMetaHash);
    expect(merged.evidence).toEqual(canonical.evidence);
    expect(merged.review).toEqual(canonical.review);
    expect(merged.cv.summary).toEqual({
      ...canonical.cv.summary,
      userEdit: "User-approved wording.",
    });
    expect(merged.cv.latestExperience.addedBullets[0]).toEqual({
      ...canonical.cv.latestExperience.addedBullets[0],
      accepted: false,
    });
  });

  it("rebuilds bullet evidence and blocks forged client provenance", () => {
    const canonical = attachEvidenceAndReview({
      aiContent: baseContent(),
      resumeSnapshot: {
        summary: "Built reliable TypeScript services.",
        skills: [{ label: "Languages", items: ["TypeScript"] }],
      },
      jobDescription: "Build reliable TypeScript services.",
      scopeKey: "tenant-1",
    });
    const submitted = structuredClone(canonical);
    submitted.cv.latestExperience.addedBullets[0].evidenceIds = [
      `ev_${"f".repeat(32)}`,
    ];
    submitted.review = {
      verdict: "pass",
      reviewedAt: "2026-07-20T12:00:00.000Z",
      coveragePercent: 100,
      requirements: [],
      issues: [],
    };

    const rebuilt = rebuildCanonicalAiContent({
      canonical,
      submitted,
      resumeSnapshot: {
        summary: "Built reliable TypeScript services.",
        skills: [{ label: "Languages", items: ["TypeScript"] }],
      },
      jobDescription: "Build reliable TypeScript services.",
      scopeKey: "tenant-1",
    });

    const rebuiltEvidenceIds =
      rebuilt.cv.latestExperience.addedBullets[0].evidenceIds ?? [];
    expect(rebuiltEvidenceIds).not.toContain(`ev_${"f".repeat(32)}`);
    expect(rebuiltEvidenceIds.length).toBeGreaterThan(0);
    expect(rebuilt.review?.verdict).not.toBe("blocked");
  });
});
