import { beforeEach, describe, expect, it, vi } from "vitest";

type ResumeRenderInput = ReturnType<
  typeof import("@/lib/server/latex/mapResumeProfile").mapResumeProfile
>;

const resumeRender = vi.hoisted(() => ({
  renderResumeTex: vi.fn((_input: ResumeRenderInput) => "\\documentclass{article}"),
}));
const dependencies = vi.hoisted(() => ({
  compileLatexToPdf: vi.fn(async () => Buffer.from("%PDF")),
  getResumeProfile: vi.fn(),
  mapResumeProfile: vi.fn(),
}));

vi.mock("@/lib/server/latex/renderResume", () => resumeRender);
vi.mock("@/lib/server/latex/compilePdf", () => ({
  compileLatexToPdf: dependencies.compileLatexToPdf,
}));
vi.mock("@/lib/server/resumeProfile", () => ({
  getResumeProfile: dependencies.getResumeProfile,
}));
vi.mock("@/lib/server/latex/mapResumeProfile", () => ({
  mapResumeProfile: dependencies.mapResumeProfile,
}));

import { buildManualImportArtifact } from "./manualImportArtifact";
import { renderApplicationPdf } from "./finalizeApplication";

const masterRenderInput: ResumeRenderInput = {
  candidate: {
    name: "Jane Doe",
    title: "Engineer",
    email: "jane@example.com",
    phone: "+61 400 000 000",
    linkedinUrl: undefined,
    linkedinText: undefined,
    githubUrl: undefined,
    githubText: undefined,
    websiteUrl: undefined,
    websiteText: undefined,
  },
  summary: "Master summary",
  skills: [{ label: "Core", items: ["TypeScript"] }],
  experiences: [
    {
      title: "Engineer",
      company: "Acme",
      location: "Sydney",
      dates: "2022-2024",
      bullets: ["Built APIs.", "Maintained CI/CD."],
      links: [],
    },
  ],
  projects: [],
  education: [],
};

const profile = {
  basics: { fullName: "Jane Doe", title: "Engineer" },
  summary: "Master summary",
  experiences: [
    {
      title: "Engineer",
      company: "Acme",
      bullets: ["Built APIs.", "Maintained CI/CD."],
    },
  ],
};

describe("Application resume render parity", () => {
  beforeEach(() => {
    resumeRender.renderResumeTex.mockClear();
    dependencies.compileLatexToPdf.mockClear();
    dependencies.getResumeProfile.mockReset().mockResolvedValue(profile);
    dependencies.mapResumeProfile.mockReset().mockReturnValue(masterRenderInput);
  });

  it("renders the same input for direct FINAL and DRAFT to FINAL", async () => {
    const direct = buildManualImportArtifact({
      evidenceScopeKey: "user-1",
      target: "resume",
      modelOutput: JSON.stringify({
        cvSummary: "Tailored **summary**.",
        latestExperience: {
          bullets: ["Maintained CI/CD.", "Built APIs."],
        },
        skillsFinal: [{ label: "Injected", items: ["Unpersisted skill"] }],
      }),
      mode: "legacy",
      source: "manual_import",
      promptMetaHash: "prompt-hash",
      renderInput: masterRenderInput,
      profile,
      job: {
        title: "Platform Engineer",
        company: "Example Co",
        description: "Build APIs and maintain CI/CD.",
      },
    });

    expect(direct.ok).toBe(true);
    if (!direct.ok) return;
    const directRenderInput = resumeRender.renderResumeTex.mock.calls[0]?.[0];
    resumeRender.renderResumeTex.mockClear();

    await renderApplicationPdf({
      applicationId: "application-1",
      userId: "user-1",
      resumeProfileId: "profile-1",
      aiContent: direct.aiContent,
      job: {
        id: "job-1",
        title: "Platform Engineer",
        company: "Example Co",
        market: "AU",
      },
    });

    expect(resumeRender.renderResumeTex).toHaveBeenCalledTimes(1);
    expect(resumeRender.renderResumeTex.mock.calls[0]?.[0]).toEqual(
      directRenderInput,
    );
    expect(directRenderInput?.skills).toEqual(masterRenderInput.skills);
    expect(directRenderInput?.experiences[0]?.bullets).toEqual([
      "Built APIs.",
      "Maintained CI/CD.",
    ]);
  });
});
