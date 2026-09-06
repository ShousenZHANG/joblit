import { beforeEach, describe, expect, it, vi } from "vitest";

type ResumeRenderInput = Parameters<
  typeof import("@/lib/server/latex/renderResume").renderResumeTex
>[0];
type CoverRenderInput = Parameters<
  typeof import("@/lib/server/latex/renderCoverLetter").renderCoverLetterTex
>[0];

const resumeRender = vi.hoisted(() => ({
  renderResumeTex: vi.fn((_input: ResumeRenderInput) => "\\documentclass{article}% resume"),
}));

const coverRender = vi.hoisted(() => ({
  renderCoverLetterTex: vi.fn(
    (_input: CoverRenderInput) => "\\documentclass{article}% cover",
  ),
}));

vi.mock("@/lib/server/latex/renderResume", () => resumeRender);
vi.mock("@/lib/server/latex/renderCoverLetter", () => coverRender);

import { buildManualImportArtifact } from "./manualImportArtifact";
import { AI_CONTENT_SCHEMA_VERSION } from "@/lib/shared/schemas/aiContent";

const skills = [
  { label: "Backend", items: ["Java", "Spring Boot"] },
  { label: "Platform", items: ["Linux", "Docker"] },
];

const renderInput = {
  candidate: {
    name: "Jane Doe",
    title: "Software Engineer",
    phone: "+61 400 000 000",
    email: "jane@example.com",
    linkedinUrl: "https://linkedin.com/in/jane",
    linkedinText: "linkedin.com/in/jane",
    githubUrl: undefined,
    githubText: undefined,
    websiteUrl: undefined,
    websiteText: undefined,
  },
  summary: "Base summary",
  skills,
  experiences: [
    {
      title: "Engineer",
      company: "Acme",
      location: "Sydney",
      dates: "2022-2024",
      bullets: ["Built Java APIs.", "Maintained CI/CD pipelines on Linux."],
      links: [],
    },
  ],
  projects: [],
  education: [],
  certifications: [],
};

const profile = {
  basics: { fullName: "Jane Doe", title: "Engineer" },
  summary: "Delivered Java services and Linux CI/CD improvements.",
  updatedAt: new Date("2026-02-22T10:00:00.000Z"),
  experiences: [
    {
      title: "Engineer",
      company: "Acme",
      bullets: ["Built Java APIs.", "Maintained CI/CD pipelines on Linux."],
    },
  ],
  skills,
};

const job = {
  title: "Software Engineer",
  company: "Example Co",
  description: "Build Java APIs and improve CI/CD delivery.",
};

const SUMMARY =
  "Software Engineer delivering **Java** services and reliable Linux CI/CD " +
  "improvements for platform teams, with a focus on maintainable APIs and " +
  "dependable production delivery.";

/** Platform first, then Backend narrowed to one item. */
const SELECTION = [
  { group: 1, items: [1, 0] },
  { group: 0, items: [0] },
];

describe("manual import artifact builder", () => {
  beforeEach(() => {
    resumeRender.renderResumeTex.mockClear();
    coverRender.renderCoverLetterTex.mockClear();
  });

  it("returns structured parse errors instead of HTTP responses", () => {
    const result = buildManualImportArtifact({
      target: "resume",
      modelOutput: "invalid-output-invalid-output",
      source: "manual_import",
      promptMetaHash: "prompt-hash",
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

  it("records the companion as local AI while accepting only the current resume contract", () => {
    const input = { target: "resume" as const, source: "local_ai" as const, promptMetaHash: "companion-prompt", renderInput, profile, job };
    const accepted = buildManualImportArtifact({ ...input, modelOutput: JSON.stringify({ cvSummary: SUMMARY, skillsSelection: SELECTION }) });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.aiContent.source).toBe("local_ai");
    expect(accepted.aiContent.provenance?.resume).toMatchObject({ source: "local_ai", promptMetaHash: "companion-prompt" });
    const rejected = buildManualImportArtifact({ ...input, modelOutput: JSON.stringify({ cv_summary: SUMMARY, skills_selection: SELECTION }) });
    expect(rejected).toMatchObject({ ok: false, error: { code: "INVALID_AI_RESULT" } });
    expect(resumeRender.renderResumeTex).toHaveBeenCalledTimes(1);
  });

  it("builds a reproducible resume from canonical AI content and the Master Profile", () => {
    const result = buildManualImportArtifact({
      target: "resume",
      modelOutput: JSON.stringify({
        cvSummary: SUMMARY,
        skillsSelection: SELECTION,
      }),
      source: "manual_import",
      promptMetaHash: "prompt-hash",
      renderInput,
      profile,
      job,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filename).toBe("Jane Doe Software Engineer_CV.pdf");
    expect(resumeRender.renderResumeTex).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: expect.stringContaining("\\textbf{Java}"),
      }),
    );
    // Experience bullets are the candidate's own and tailoring never touches
    // them: the summary and the skill order are the whole delta.
    const renderArg = resumeRender.renderResumeTex.mock.calls[0][0];
    expect(renderArg.experiences).toEqual(renderInput.experiences);
  });

  it("renders the tailored skill order the model selected", () => {
    buildManualImportArtifact({
      target: "resume",
      modelOutput: JSON.stringify({
        cvSummary: SUMMARY,
        skillsSelection: SELECTION,
      }),
      source: "manual_import",
      promptMetaHash: "prompt-hash",
      renderInput,
      profile,
      job,
    });

    expect(resumeRender.renderResumeTex.mock.calls[0][0].skills).toEqual([
      { label: "Platform", items: ["Docker", "Linux"] },
      { label: "Backend", items: ["Java"] },
    ]);
  });

  it("renders only strings the candidate already wrote on the profile", () => {
    // The selection is index references, so resolving it can add nothing. This
    // is what makes selection-by-reference safe.
    buildManualImportArtifact({
      target: "resume",
      modelOutput: JSON.stringify({
        cvSummary: SUMMARY,
        skillsSelection: SELECTION,
      }),
      source: "manual_import",
      promptMetaHash: "prompt-hash",
      renderInput,
      profile,
      job,
    });

    const owned = new Set(skills.flatMap((group) => group.items));
    for (const group of resumeRender.renderResumeTex.mock.calls[0][0].skills) {
      for (const item of group.items) expect(owned.has(item)).toBe(true);
    }
  });

  it("emits aiContent provenance covering the summary diff and the AI selection", () => {
    const result = buildManualImportArtifact({
      target: "resume",
      modelOutput: JSON.stringify({
        cvSummary: SUMMARY,
        skillsSelection: SELECTION,
      }),
      source: "manual_import",
      promptMetaHash: "prompt-hash",
      renderInput,
      profile,
      job,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.aiContent.schemaVersion).toBe(AI_CONTENT_SCHEMA_VERSION);
    expect(result.aiContent.promptMetaHash).toBe("prompt-hash");
    expect(result.aiContent.source).toBe("manual_import");
    expect(result.aiContent.provenance).toEqual({
      resume: {
        generatedAt: result.aiContent.generatedAt,
        promptMetaHash: "prompt-hash",
        source: "manual_import",
      },
    });

    expect(result.aiContent.cv.summary).toEqual(
      expect.objectContaining({
        aiText: SUMMARY,
        originalText: "Base summary",
      }),
    );
    expect(result.aiContent.cv.skillsSelection).toEqual({
      aiSelection: SELECTION,
    });
  });

  // A model that still emits a retired key must not smuggle skills onto the CV
  // through the back door: only the index selection is read.
  it("ignores a retired skillsAdditions key and renders the profile's own skills", () => {
    const result = buildManualImportArtifact({
      target: "resume",
      modelOutput: JSON.stringify({
        cvSummary: SUMMARY,
        skillsSelection: SELECTION,
        skillsAdditions: [
          {
            category: String.raw`Cloud & \input{secret}`,
            items: [String.raw`AWS 100% \write18{calc}`],
          },
        ],
      }),
      source: "manual_import",
      promptMetaHash: "prompt-hash",
      renderInput,
      profile,
      job,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const renderArg = resumeRender.renderResumeTex.mock.calls[0][0];
    expect(JSON.stringify(renderArg)).not.toContain("write18");
    expect(JSON.stringify(result.aiContent)).not.toContain("write18");
  });

  it("rejects a selection index the candidate's profile cannot resolve", () => {
    const result = buildManualImportArtifact({
      target: "resume",
      modelOutput: JSON.stringify({
        cvSummary: SUMMARY,
        skillsSelection: [{ group: 6, items: [0] }],
      }),
      source: "manual_import",
      promptMetaHash: "prompt-hash",
      renderInput,
      profile,
      job,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual(
      expect.objectContaining({
        status: 400,
        code: "SKILLS_SELECTION_INVALID",
      }),
    );
    expect(resumeRender.renderResumeTex).not.toHaveBeenCalled();
  });

  it("builds cover artifacts with quality gate metadata", () => {
    const result = buildManualImportArtifact({
      target: "cover",
      modelOutput: JSON.stringify({
        cover: {
          candidateTitle: "Injected title",
          subject: "Injected subject",
          salutation: "Injected salutation",
          paragraphOne: "One",
          paragraphTwo: "Two",
          paragraphThree: "Three",
          closing: "Injected closing",
          signatureName: "Injected name",
        },
      }),
      source: "manual_import",
      promptMetaHash: "prompt-hash",
      renderInput,
      profile,
      job,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filename).toBe("Jane Doe Software Engineer_CL.pdf");
    expect(result.coverQualityGate).toBe("soft-fail");
    expect(result.aiContent.provenance).toEqual({
      cover: {
        generatedAt: result.aiContent.generatedAt,
        promptMetaHash: "prompt-hash",
        source: "manual_import",
      },
    });
    expect(coverRender.renderCoverLetterTex).toHaveBeenCalledWith(
      expect.objectContaining({
        company: "Example Co",
        role: "Software Engineer",
        paragraphOne: "One",
      }),
    );
    const coverRenderInput = coverRender.renderCoverLetterTex.mock.calls[0][0];
    expect(coverRenderInput).not.toHaveProperty("subject");
    expect(coverRenderInput).not.toHaveProperty("salutation");
    expect(coverRenderInput).not.toHaveProperty("closing");
    expect(JSON.stringify(result.aiContent)).not.toContain("Injected");
  });
});
