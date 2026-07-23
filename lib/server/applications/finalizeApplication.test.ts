import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiContent } from "@/lib/shared/schemas/aiContent";

const dependencies = vi.hoisted(() => ({
  compileLatexToPdf: vi.fn(),
  getResumeProfile: vi.fn(),
  mapResumeProfile: vi.fn(),
}));

vi.mock("@vercel/blob", () => ({
  del: vi.fn(),
  put: vi.fn(),
}));
vi.mock("@/lib/server/latex/compilePdf", () => ({
  compileLatexToPdf: dependencies.compileLatexToPdf,
}));
vi.mock("@/lib/server/resumeProfile", () => ({
  getResumeProfile: dependencies.getResumeProfile,
}));
vi.mock("@/lib/server/latex/mapResumeProfile", () => ({
  mapResumeProfile: dependencies.mapResumeProfile,
}));

import {
  renderApplicationPdf,
  renderCoverLetterPdf,
} from "./finalizeApplication";

const aiContent: AiContent = {
  schemaVersion: 1,
  generatedAt: "2026-07-20T00:00:00.000Z",
  promptMetaHash: "sha256:test",
  evidence: [
    {
      id: `ev_${"a".repeat(32)}`,
      kind: "candidate",
      path: "resume.skills[0]",
      contentHash: "a".repeat(64),
      excerpt: "aws cloud engineering",
    },
  ],
  cv: {
    summary: {
      aiText: "Security-focused engineer",
      originalText: "Engineer",
      accepted: true,
    },
    latestExperience: {
      experienceIndex: 0,
      addedBullets: [],
    },
  },
  cover: {
    paragraphOne: { aiText: "One", accepted: true },
    paragraphTwo: { aiText: "Two", accepted: true },
    paragraphThree: { aiText: "Three", accepted: true },
  },
};

describe("renderApplicationPdf", () => {
  beforeEach(() => {
    dependencies.compileLatexToPdf.mockReset();
    dependencies.getResumeProfile.mockReset().mockResolvedValue({});
    dependencies.mapResumeProfile.mockReset().mockReturnValue({
      candidate: {
        name: "Jane Doe",
        title: "Engineer",
        email: "jane@example.com",
        phone: "+61 400 000 000",
        linkedinUrl: "https://linkedin.com/in/jane",
        linkedinText: "linkedin.com/in/jane",
      },
      summary: "Engineer",
      skills: [{ label: "Core", items: ["TypeScript"] }],
      experiences: [],
      projects: [],
      education: [],
    });
    dependencies.compileLatexToPdf.mockResolvedValue(Buffer.from("%PDF"));
  });

  // The AI no longer contributes skills, so the only path into the skills
  // section is the master profile, which mapResumeProfile has already escaped.
  it("renders the master-profile skills section untouched", async () => {
    await renderApplicationPdf({
      applicationId: "application-1",
      userId: "user-1",
      aiContent,
      job: {
        id: "job-1",
        title: "Engineer",
        company: "Joblit",
        market: "AU",
      },
    });

    const tex = dependencies.compileLatexToPdf.mock.calls[0]?.[0] as string;
    expect(tex).toContain("TypeScript");
  });

  it("loads the Application-linked profile instead of the current active profile", async () => {
    await renderApplicationPdf({
      applicationId: "application-1",
      userId: "user-1",
      resumeProfileId: "profile-linked",
      aiContent,
      job: {
        id: "job-1",
        title: "Engineer",
        company: "Joblit",
        market: "AU",
      },
    });

    expect(dependencies.getResumeProfile).toHaveBeenCalledWith("user-1", {
      profileId: "profile-linked",
      locale: "en-AU",
    });
  });

  it("uses the same Application-linked profile for cover letters", async () => {
    await renderCoverLetterPdf({
      applicationId: "application-1",
      userId: "user-1",
      resumeProfileId: "profile-linked",
      aiContent,
      job: {
        id: "job-1",
        title: "Engineer",
        company: "Joblit",
        market: "AU",
      },
    });

    expect(dependencies.getResumeProfile).toHaveBeenCalledWith("user-1", {
      profileId: "profile-linked",
      locale: "en-AU",
    });
  });

  describe("when the Master Resume Profile is gone", () => {
    // Deleting the profile between draft and finalize used to throw
    // `new Error("MASTER_PROFILE_MISSING")`, which the finalize route did not
    // rescue — the user got an opaque 500 with no code, while the same failure
    // was a typed 404 on the manual path.
    beforeEach(() => dependencies.getResumeProfile.mockResolvedValue(null));

    it("fails the resume render with a typed 404", async () => {
      await expect(
        renderApplicationPdf({
          applicationId: "application-1",
          userId: "user-1",
          resumeProfileId: "profile-linked",
          aiContent,
          job: { id: "job-1", title: "Engineer", company: "Joblit", market: "AU" },
        }),
      ).rejects.toMatchObject({ code: "NO_PROFILE", status: 404 });
    });

    it("fails the cover render with a typed 404", async () => {
      await expect(
        renderCoverLetterPdf({
          applicationId: "application-1",
          userId: "user-1",
          resumeProfileId: "profile-linked",
          aiContent,
          job: { id: "job-1", title: "Engineer", company: "Joblit", market: "AU" },
        }),
      ).rejects.toMatchObject({ code: "NO_PROFILE", status: 404 });
    });
  });
});
