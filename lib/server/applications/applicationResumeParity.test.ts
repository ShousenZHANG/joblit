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

const skills = [
  { label: "Core", items: ["TypeScript", "Node.js"] },
  { label: "Cloud", items: ["AWS"] },
];

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
  skills,
  experiences: [
    {
      title: "Engineer",
      company: "Acme",
      location: "Sydney",
      dates: "2022-2024",
      bullets: ["Built TypeScript APIs.", "Maintained CI/CD."],
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
      bullets: ["Built TypeScript APIs.", "Maintained CI/CD."],
    },
  ],
  skills,
};

const job = {
  title: "Platform Engineer",
  company: "Example Co",
  description: "Build TypeScript APIs and maintain CI/CD.",
};

const SUMMARY =
  "Platform Engineer building **TypeScript** APIs and maintaining CI/CD on " +
  "AWS, focused on reliable delivery for product teams that depend on Node.js " +
  "services running in production.";

/** Cloud first, Core narrowed to one item — a tailored, non-default order. */
const SELECTION = [
  { group: 1, items: [0] },
  { group: 0, items: [1] },
];

describe("Application resume render parity", () => {
  beforeEach(() => {
    resumeRender.renderResumeTex.mockClear();
    dependencies.compileLatexToPdf.mockClear();
    dependencies.getResumeProfile.mockReset().mockResolvedValue(profile);
    dependencies.mapResumeProfile.mockReset().mockReturnValue(masterRenderInput);
  });

  it("renders the same input for direct FINAL and DRAFT to FINAL", async () => {
    const direct = buildManualImportArtifact({
      target: "resume",
      modelOutput: JSON.stringify({
        cvSummary: SUMMARY,
        skillsSelection: SELECTION,
      }),
      source: "manual_import",
      promptMetaHash: "prompt-hash",
      renderInput: masterRenderInput,
      profile,
      job,
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
        title: job.title,
        company: job.company,
        market: "AU",
      },
    });

    expect(resumeRender.renderResumeTex).toHaveBeenCalledTimes(1);
    expect(resumeRender.renderResumeTex.mock.calls[0]?.[0]).toEqual(
      directRenderInput,
    );
  });

  it("carries the tailored skill order into both renders, not the profile default", () => {
    // Parity is only meaningful if the two paths agree on something the master
    // profile does not already say.
    buildManualImportArtifact({
      target: "resume",
      modelOutput: JSON.stringify({
        cvSummary: SUMMARY,
        skillsSelection: SELECTION,
      }),
      source: "manual_import",
      promptMetaHash: "prompt-hash",
      renderInput: masterRenderInput,
      profile,
      job,
    });

    const rendered = resumeRender.renderResumeTex.mock.calls[0]?.[0];
    expect(rendered?.skills).toEqual([
      { label: "Cloud", items: ["AWS"] },
      { label: "Core", items: ["Node.js"] },
    ]);
    expect(rendered?.skills).not.toEqual(masterRenderInput.skills);
    expect(rendered?.experiences).toEqual(masterRenderInput.experiences);
  });
});
