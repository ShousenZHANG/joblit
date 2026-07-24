import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  tailorApplicationContent: vi.fn(),
  mapResumeProfile: vi.fn(),
  renderResumeTex: vi.fn(),
  compileLatexToPdf: vi.fn(),
}));

vi.mock("@/lib/server/ai/tailorApplication", () => ({
  tailorApplicationContent: dependencies.tailorApplicationContent,
}));
vi.mock("@/lib/server/latex/mapResumeProfile", () => ({
  mapResumeProfile: dependencies.mapResumeProfile,
}));
vi.mock("@/lib/server/latex/renderResume", () => ({
  renderResumeTex: dependencies.renderResumeTex,
}));
vi.mock("@/lib/server/latex/compilePdf", () => ({
  compileLatexToPdf: dependencies.compileLatexToPdf,
}));

import { buildResumePdfForJob } from "./buildResumePdf";

const master = {
  candidate: {
    name: "Jane Doe",
    title: "Engineer",
    email: "jane@example.com",
    phone: "+61 400 000 000",
  },
  summary: "Master summary",
  skills: [{ label: "Core", items: ["TypeScript"] }],
  experiences: [
    {
      title: "Engineer",
      company: "Acme",
      location: "Sydney",
      dates: "2022-2024",
      bullets: ["Master bullet"],
      links: [],
    },
  ],
  projects: [],
  education: [],
};

describe("buildResumePdfForJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dependencies.mapResumeProfile.mockReturnValue(master);
    dependencies.tailorApplicationContent.mockResolvedValue({
      cvSummary: "Tailored **summary** & delivery.",
      cover: {
        paragraphOne: "One",
        paragraphTwo: "Two",
        paragraphThree: "Three",
      },
      source: { cv: "ai", cover: "ai" },
      reason: "ai_ok",
    });
    dependencies.renderResumeTex.mockReturnValue("\\documentclass{article}");
    dependencies.compileLatexToPdf.mockResolvedValue(Buffer.from("%PDF"));
  });

  it("renders and returns the same canonical CV state", async () => {
    const result = await buildResumePdfForJob({
      userId: "user-1",
      profile: {
        id: "profile-1",
        summary: "Master summary",
      } as never,
      job: {
        title: "Platform Engineer",
        company: "Example Co",
        description: "Build reliable platforms.",
      },
    });

    expect(result.cv).toEqual({
      summary: {
        aiText: "Tailored **summary** & delivery.",
        originalText: "Master summary",
        accepted: true,
      },
      latestExperience: {
        experienceIndex: 0,
        addedBullets: [],
      },
    });
    expect(dependencies.renderResumeTex).toHaveBeenCalledWith({
      ...master,
      summary: "Tailored \\textbf{summary} \\& delivery.",
    });
  });
});
