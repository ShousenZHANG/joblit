import { describe, expect, it } from "vitest";
import { applicationReviewSnapshotSchema } from "./applicationReviewSnapshot";

const snapshot = {
  applicationId: "22222222-2222-4222-8222-222222222222",
  publication: {
    status: "FINAL",
    resume: {
      status: "FINAL",
      contentHash: "resume-hash",
      publishedHash: "resume-hash",
    },
    cover: {
      status: "FINAL",
      contentHash: "cover-hash",
      publishedHash: "cover-hash",
    },
  },
  aiContentHash: "content-hash",
  aiContent: {
    schemaVersion: 2,
    generatedAt: "2026-08-10T00:00:00.000Z",
    promptMetaHash: "prompt-hash",
    cv: {
      summary: {
        aiText: "Platform engineer focused on reliable systems.",
        originalText: "Software engineer.",
        accepted: true,
      },
      skillsSelection: {
        aiSelection: [{ group: 0, items: [2, 0] }],
      },
    },
    cover: {
      paragraphOne: { aiText: "One", accepted: true },
      paragraphTwo: { aiText: "Two", accepted: true },
      paragraphThree: { aiText: "Three", accepted: true },
    },
  },
  documents: {
    resume: { pdfUrl: "https://example.com/cv.pdf", pdfName: "Ada Role_CV.pdf" },
    cover: { pdfUrl: "https://example.com/cl.pdf", pdfName: "Ada Role_CL.pdf" },
  },
  job: {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Platform Engineer",
    company: "Lumi",
    location: "Sydney",
    market: "AU",
  },
};

describe("application review snapshot contract", () => {
  it("accepts the complete editor bootstrap and rejects leaked transport metadata", () => {
    expect(applicationReviewSnapshotSchema.parse(snapshot)).toEqual(snapshot);

    const leaked = applicationReviewSnapshotSchema.safeParse({
      ...snapshot,
      prompt: "private prompt bytes",
    });
    expect(leaked.success).toBe(false);
  });
});
