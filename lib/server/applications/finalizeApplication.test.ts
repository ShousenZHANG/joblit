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
    skillsAdditions: [
      {
        label: String.raw`Cloud & \input{secret}`,
        items: [String.raw`AWS 100% \write18{calc}`],
        accepted: true,
        evidenceIds: [`ev_${"a".repeat(32)}`],
      },
    ],
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

  it("escapes user-editable skill labels and items before rendering LaTeX", async () => {
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
    expect(tex).not.toContain(String.raw`\input{secret}`);
    expect(tex).not.toContain(String.raw`\write18{calc}`);
    expect(tex).toContain(String.raw`Cloud \& \\input\{secret\}`);
    expect(tex).toContain(String.raw`AWS 100\% \\write18\{calc\}`);
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
});
