import { beforeEach, describe, expect, it, vi } from "vitest";

const stores = vi.hoisted(() => ({
  application: { findFirst: vi.fn() },
  tailoringRun: { findFirst: vi.fn() },
}));

const profileDependency = vi.hoisted(() => ({
  getResumeProfile: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({ prisma: stores }));
vi.mock("@/lib/server/resumeProfile", () => profileDependency);

import { loadApplicationReviewSnapshot } from "./applicationReviewSnapshot";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const APPLICATION_ID = "22222222-2222-4222-8222-222222222222";
const JOB_ID = "33333333-3333-4333-8333-333333333333";

const profile = {
  summary: "Platform engineer focused on reliable systems.",
  basics: {
    fullName: "Alex Chen",
    title: "Platform Engineer",
    email: "alex@example.com",
    phone: "+61 400 000 000",
  },
  links: [],
  skills: [{ category: "Platform", items: ["Kubernetes"] }],
  experiences: [
    {
      title: "Engineer",
      company: "Example",
      location: "Sydney",
      dates: "2023-present",
      bullets: ["Built reliable services."],
      links: [],
    },
  ],
  projects: [],
  education: [],
};

const aiContent = {
  schemaVersion: 1,
  generatedAt: "2026-08-10T00:00:00.000Z",
  promptMetaHash: "prompt-hash",
  provenance: {
    resume: {
      generatedAt: "2026-08-10T00:00:00.000Z",
      promptMetaHash: "resume-prompt",
      source: "codex_batch",
    },
    cover: {
      generatedAt: "2026-08-10T00:01:00.000Z",
      promptMetaHash: "cover-prompt",
      source: "codex_batch",
    },
  },
  cv: {
    summary: {
      aiText: "Platform engineer focused on reliable systems.",
      originalText: "Software engineer.",
      accepted: true,
    },
    latestExperience: { experienceIndex: 0, addedBullets: [] },
  },
  cover: {
    paragraphOne: { aiText: "One", accepted: true },
    paragraphTwo: { aiText: "Two", accepted: true },
    paragraphThree: { aiText: "Three", accepted: true },
  },
};

function applicationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: APPLICATION_ID,
    status: "FINAL",
    aiContent,
    aiContentHash: "content-hash",
    resumePdfUrl: "https://example.com/cv.pdf",
    resumePdfName: "Stored CV.pdf",
    coverPdfUrl: "https://example.com/cl.pdf",
    resumeContentHash: null,
    coverContentHash: null,
    resumePublishedHash: null,
    coverPublishedHash: null,
    role: null,
    company: null,
    jobId: JOB_ID,
    resumeProfileId: "44444444-4444-4444-8444-444444444444",
    job: {
      id: JOB_ID,
      userId: USER_ID,
      title: "Platform Engineer",
      company: "Lumi",
      location: "Sydney",
      market: "AU",
    },
    resumeProfile: { ...profile, userId: USER_ID },
    ...overrides,
  };
}

describe("application review snapshot", () => {
  beforeEach(() => {
    stores.application.findFirst.mockReset();
    stores.tailoringRun.findFirst.mockReset();
    stores.tailoringRun.findFirst.mockResolvedValue(null);
    profileDependency.getResumeProfile.mockReset();
  });

  it("loads the owned Application as one editor-ready snapshot", async () => {
    stores.application.findFirst.mockResolvedValueOnce(applicationRow());

    const result = await loadApplicationReviewSnapshot({
      userId: USER_ID,
      applicationId: APPLICATION_ID,
    });

    expect(result).toEqual({
      kind: "ready",
      snapshot: expect.objectContaining({
        applicationId: APPLICATION_ID,
        aiContent,
        aiContentHash: "content-hash",
        publication: expect.objectContaining({
          status: "DRAFT",
          resume: expect.objectContaining({ status: "DRAFT" }),
          cover: expect.objectContaining({ status: "DRAFT" }),
        }),
        documents: {
          resume: {
            pdfUrl: "https://example.com/cv.pdf",
            pdfName: "Stored CV.pdf",
          },
          cover: {
            pdfUrl: "https://example.com/cl.pdf",
            pdfName: "Alex Chen Platform Engineer_CL.pdf",
          },
        },
        job: {
          id: JOB_ID,
          title: "Platform Engineer",
          company: "Lumi",
          location: "Sydney",
          market: "AU",
        },
      }),
    });
    expect(profileDependency.getResumeProfile).not.toHaveBeenCalled();
  });

  it("fails closed when the bound Job belongs to another user", async () => {
    stores.application.findFirst.mockResolvedValueOnce(
      applicationRow({
        job: {
          ...applicationRow().job,
          userId: "55555555-5555-4555-8555-555555555555",
        },
      }),
    );

    await expect(
      loadApplicationReviewSnapshot({
        userId: USER_ID,
        applicationId: APPLICATION_ID,
      }),
    ).resolves.toEqual({ kind: "not_found" });
    expect(stores.tailoringRun.findFirst).not.toHaveBeenCalled();
  });

  it("fails closed when the bound ResumeProfile belongs to another user", async () => {
    stores.application.findFirst.mockResolvedValueOnce(
      applicationRow({
        resumeProfile: {
          ...profile,
          userId: "55555555-5555-4555-8555-555555555555",
        },
      }),
    );

    await expect(
      loadApplicationReviewSnapshot({
        userId: USER_ID,
        applicationId: APPLICATION_ID,
      }),
    ).resolves.toEqual({ kind: "not_found" });
    expect(stores.tailoringRun.findFirst).not.toHaveBeenCalled();
  });

  it("does not open an edit session while generation still owns the Job", async () => {
    stores.application.findFirst.mockResolvedValueOnce(applicationRow());
    stores.tailoringRun.findFirst.mockResolvedValueOnce({ id: "run-1" });

    await expect(
      loadApplicationReviewSnapshot({
        userId: USER_ID,
        applicationId: APPLICATION_ID,
      }),
    ).resolves.toEqual({ kind: "busy" });
    expect(stores.tailoringRun.findFirst).toHaveBeenCalledWith({
      where: {
        userId: USER_ID,
        jobId: JOB_ID,
        status: { in: ["ISSUED", "RUNNING"] },
      },
      select: { id: true },
    });
  });
});
