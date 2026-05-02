import { beforeEach, describe, expect, it, vi } from "vitest";

const resumeRender = vi.hoisted(() => ({
  renderResumeTex: vi.fn(() => "\\documentclass{article}% resume"),
}));

const coverRender = vi.hoisted(() => ({
  renderCoverLetterTex: vi.fn(() => "\\documentclass{article}% cover"),
}));

vi.mock("@/lib/server/latex/renderResume", () => resumeRender);
vi.mock("@/lib/server/latex/renderCoverLetter", () => coverRender);

import { buildManualImportArtifact } from "./manualImportArtifact";

const renderInput = {
  candidate: {
    name: "Jane Doe",
    title: "Software Engineer",
    phone: "+61 400 000 000",
    email: "jane@example.com",
    linkedinUrl: "https://linkedin.com/in/jane",
    linkedinText: "linkedin.com/in/jane",
  },
  summary: "Base summary",
  skills: [{ label: "Backend", items: ["Java"] }],
  experiences: [
    {
      title: "Engineer",
      company: "Acme",
      location: "Sydney",
      dates: "2022-2024",
      bullets: ["Built Java APIs.", "Maintained CI/CD pipelines on Linux."],
    },
  ],
  projects: [],
  education: [],
};

const profile = {
  summary: "Delivered Java services and Linux CI/CD improvements.",
  updatedAt: new Date("2026-02-22T10:00:00.000Z"),
  experiences: [
    {
      title: "Engineer",
      company: "Acme",
      bullets: ["Built Java APIs.", "Maintained CI/CD pipelines on Linux."],
    },
  ],
};

const job = {
  title: "Software Engineer",
  company: "Example Co",
  description: "Build Java APIs and improve CI/CD delivery.",
};

describe("manual import artifact builder", () => {
  beforeEach(() => {
    resumeRender.renderResumeTex.mockClear();
    coverRender.renderCoverLetterTex.mockClear();
  });

  it("returns structured parse errors instead of HTTP responses", () => {
    const result = buildManualImportArtifact({
      target: "resume",
      modelOutput: "invalid-output-invalid-output",
      renderInput,
      profile,
      job,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual(
      expect.objectContaining({
        status: 400,
        code: "PARSE_FAILED",
      }),
    );
  });

  it("builds a resume artifact and keeps grounded latest-experience content", () => {
    const result = buildManualImportArtifact({
      target: "resume",
      modelOutput: JSON.stringify({
        cvSummary: "Focused on **Java** services and reliable delivery.",
        latestExperience: {
          bullets: [
            "Maintained CI/CD pipelines on Linux.",
            "Built Java APIs.",
            "Led unrelated M&A diligence.",
          ],
        },
        skillsFinal: [{ label: "Backend", items: ["Java", "Spring Boot"] }],
      }),
      renderInput,
      profile,
      job,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filename).toContain("Software_Engineer");
    expect(resumeRender.renderResumeTex).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: expect.stringContaining("\\textbf{Java}"),
        skills: [{ label: "Backend", items: ["Java", "Spring Boot"] }],
      }),
    );
    const renderArg = resumeRender.renderResumeTex.mock.calls[0]?.[0];
    expect(renderArg.experiences[0].bullets).toEqual([
      "Maintained CI/CD pipelines on Linux.",
      "Built Java APIs.",
    ]);
  });

  it("builds cover artifacts with quality gate metadata", () => {
    const result = buildManualImportArtifact({
      target: "cover",
      modelOutput: JSON.stringify({
        cover: {
          paragraphOne: "One",
          paragraphTwo: "Two",
          paragraphThree: "Three",
        },
      }),
      renderInput,
      profile,
      job,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filename).toContain("Cover_Letter");
    expect(result.coverQualityGate).toBe("soft-fail");
    expect(coverRender.renderCoverLetterTex).toHaveBeenCalledWith(
      expect.objectContaining({
        company: "Example Co",
        role: "Software Engineer",
        paragraphOne: "One",
      }),
    );
  });
});
