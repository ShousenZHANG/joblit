import { describe, expect, it } from "vitest";

import { buildGlobalSkillPackFiles } from "@/lib/server/ai/skillPack";
import { DEFAULT_RULES } from "@/lib/server/ai/promptSkills";

describe("skill pack cover prompt template", () => {
  it("includes resume summary keyword bolding guidance with JSON-only framing", () => {
    const files = buildGlobalSkillPackFiles(DEFAULT_RULES);
    const resumePrompt = files.find(
      (file) => file.name === "jobflow-tailoring/prompts/resume-user.txt",
    );

    expect(resumePrompt).toBeTruthy();
    if (!resumePrompt) return;

    const text = resumePrompt.content;
    expect(text).toContain("In cvSummary, bold JD-critical keywords using clean markdown **keyword** markers.");
    expect(text).toContain("JSON-only requirement applies to outer output structure");
  });

  it("includes recruiter-style top-3 alignment, full keyword bolding guidance, and natural-professional tone", () => {
    const files = buildGlobalSkillPackFiles(DEFAULT_RULES);
    const coverPrompt = files.find(
      (file) => file.name === "jobflow-tailoring/prompts/cover-user.txt",
    );

    expect(coverPrompt).toBeTruthy();
    if (!coverPrompt) return;

    const text = coverPrompt.content;
    expect(text).toContain("Top-3 JD responsibilities");
    expect(text).toContain("Bold all JD-critical keywords");
    expect(text).toContain("professional but natural");
  });

  it("exports formal JSON schemas for resume and cover contracts", () => {
    const files = buildGlobalSkillPackFiles(DEFAULT_RULES);
    const resumeSchema = files.find(
      (file) => file.name === "jobflow-tailoring/schema/output.resume.schema.json",
    );
    const coverSchema = files.find(
      (file) => file.name === "jobflow-tailoring/schema/output.cover.schema.json",
    );

    expect(resumeSchema).toBeTruthy();
    expect(coverSchema).toBeTruthy();
    if (!resumeSchema || !coverSchema) return;

    const resumeParsed = JSON.parse(resumeSchema.content);
    const coverParsed = JSON.parse(coverSchema.content);

    expect(resumeParsed.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(resumeParsed.type).toBe("object");
    expect(coverParsed.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(coverParsed.type).toBe("object");
  });

  it("supports redacted skill pack context export", () => {
    const files = buildGlobalSkillPackFiles(
      DEFAULT_RULES,
      {
        resumeSnapshot: {
          summary: "secret summary",
          experiences: [{ title: "Engineer", bullets: ["secret bullet"] }],
        },
        resumeSnapshotUpdatedAt: "2026-02-23T00:00:00.000Z",
      },
      { redactContext: true },
    );
    const context = files.find((file) => file.name === "jobflow-tailoring/context/resume-snapshot.json");

    expect(context).toBeTruthy();
    if (!context) return;

    const parsed = JSON.parse(context.content);
    expect(parsed.summary).toBe("[REDACTED]");
    expect(Array.isArray(parsed.experiences)).toBe(true);
    expect(parsed.experiences).toHaveLength(0);
  });

  it("does not include any jobflow-skill-pack path prefix", () => {
    const files = buildGlobalSkillPackFiles(DEFAULT_RULES);
    expect(files.every((f) => !f.name.startsWith("jobflow-skill-pack/"))).toBe(true);
  });

  it("includes meta/manifest.json with required fields", () => {
    const files = buildGlobalSkillPackFiles(DEFAULT_RULES, {
      resumeSnapshot: { summary: "", experiences: [] },
      resumeSnapshotUpdatedAt: "2026-02-23T00:00:00.000Z",
    });
    const manifestFile = files.find((file) => file.name === "jobflow-tailoring/meta/manifest.json");

    expect(manifestFile).toBeTruthy();
    if (!manifestFile) return;

    const manifest = JSON.parse(manifestFile.content);
    expect(manifest.packName).toBe("jobflow-tailoring");
    expect(manifest.packVersion).toBeDefined();
    expect(manifest.generatedAt).toBeDefined();
    expect(typeof manifest.redacted).toBe("boolean");
    expect(manifest.ruleSetId).toBeDefined();
    expect(manifest.resumeSnapshotUpdatedAt).toBeDefined();
    expect(manifest.skillPackVersion).toBeDefined();
    expect(Array.isArray(manifest.files)).toBe(true);
    expect(manifest.files).toContain("jobflow-tailoring/meta/manifest.json");
  });
});
