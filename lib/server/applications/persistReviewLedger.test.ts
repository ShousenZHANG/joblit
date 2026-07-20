import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@/lib/generated/prisma";
import type { AiContent } from "@/lib/shared/schemas/aiContent";
import { attachEvidenceAndReview } from "@/lib/server/ai/evidenceLedger";
import { persistReviewLedger } from "./persistReviewLedger";

const USER_ID = "11111111-1111-4111-8111-111111111111";

function content(): AiContent {
  return attachEvidenceAndReview({
    scopeKey: USER_ID,
    resumeSnapshot: { summary: "Led a TypeScript migration." },
    jobDescription: null,
    aiContent: {
    schemaVersion: 1,
    generatedAt: "2026-07-20T00:00:00.000Z",
    promptMetaHash: "test",
    cv: {
      summary: {
        aiText: "Led a TypeScript migration.",
        originalText: "",
        accepted: true,
      },
      latestExperience: { experienceIndex: 0, addedBullets: [] },
      skillsAdditions: [],
    },
    cover: {
      paragraphOne: { aiText: "", accepted: false, evidenceIds: [] },
      paragraphTwo: { aiText: "", accepted: false, evidenceIds: [] },
      paragraphThree: { aiText: "", accepted: false, evidenceIds: [] },
    },
    },
  });
}

describe("persistReviewLedger", () => {
  it("writes content-addressed evidence and idempotent claim edges", async () => {
    const evidenceCreateMany = vi.fn().mockResolvedValue({ count: 1 });
    const claimCreateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      evidenceSnapshot: { createMany: evidenceCreateMany },
      claimEvidence: { createMany: claimCreateMany },
    } as unknown as Prisma.TransactionClient;

    const aiContent = content();
    const evidenceId = aiContent.evidence?.[0]?.id;
    await persistReviewLedger(tx, {
      userId: USER_ID,
      applicationId: "22222222-2222-4222-8222-222222222222",
      jobId: "33333333-3333-4333-8333-333333333333",
      aiContent,
    });

    expect(evidenceCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skipDuplicates: true,
        data: [
          expect.objectContaining({
            id: evidenceId,
            kind: "RESUME_PROFILE",
          }),
        ],
      }),
    );
    expect(claimCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skipDuplicates: true,
        data: [
          expect.objectContaining({
            claimKey: "cv.summary",
            evidenceSnapshotId: evidenceId,
          }),
        ],
      }),
    );
  });

  it("rejects forged evidence before writing any ledger row", async () => {
    const evidenceCreateMany = vi.fn();
    const claimCreateMany = vi.fn();
    const tx = {
      evidenceSnapshot: { createMany: evidenceCreateMany },
      claimEvidence: { createMany: claimCreateMany },
    } as unknown as Prisma.TransactionClient;
    const aiContent = content();
    aiContent.evidence![0] = {
      ...aiContent.evidence![0],
      id: `ev_${"f".repeat(32)}`,
      contentHash: "f".repeat(64),
      excerpt: "improved revenue by 999%",
    };

    await expect(
      persistReviewLedger(tx, {
        userId: USER_ID,
        applicationId: "22222222-2222-4222-8222-222222222222",
        jobId: "33333333-3333-4333-8333-333333333333",
        aiContent,
      }),
    ).rejects.toThrow("INVALID_EVIDENCE_REFERENCE");
    expect(evidenceCreateMany).not.toHaveBeenCalled();
    expect(claimCreateMany).not.toHaveBeenCalled();
  });
});
