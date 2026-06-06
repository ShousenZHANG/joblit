import { describe, expect, it } from "vitest";

import { buildSkillPackV2Files } from "@/lib/server/ai/skillPack";
import { getStructuredSkillRules } from "@/lib/server/ai/promptSkills";

const rules = getStructuredSkillRules("en-AU");

function get(files: { name: string; content: string }[], name: string) {
  const file = files.find((f) => f.name === name);
  if (!file) throw new Error(`missing skill pack file: ${name}`);
  return file;
}

describe("skill pack V2 (single source of truth)", () => {
  it("ships a root SKILL.md naming the joblit-tailoring skill and validator", () => {
    const skill = get(buildSkillPackV2Files(rules), "SKILL.md");
    expect(skill.content).toContain("name: joblit-tailoring");
    expect(skill.content).toContain("scripts/validate.mjs");
  });

  it("renders instructions/system.md from the canonical in-app builder", () => {
    const sys = get(buildSkillPackV2Files(rules), "joblit-skills-v2/instructions/system.md");
    // Markers unique to buildV2SystemPrompt — proves the pack reuses it.
    expect(sys.content).toContain("<role>");
    expect(sys.content).toContain("<hard-constraints>");
    expect(sys.content).toContain("<locale-profile>");
  });

  it("renders prompt templates with job placeholders and XML task tags", () => {
    const files = buildSkillPackV2Files(rules);
    const resume = get(files, "joblit-skills-v2/prompts/resume-job-prompt.template.md");
    const cover = get(files, "joblit-skills-v2/prompts/cover-job-prompt.template.md");
    expect(resume.content).toContain("{{JOB_TITLE}}");
    expect(resume.content).toContain("<task>");
    expect(resume.content).toContain("<self-check>");
    expect(cover.content).toContain("{{JOB_DESCRIPTION}}");
    expect(cover.content).toContain("<cover-structure>");
  });

  it("ships the deterministic validator script + readme", () => {
    const files = buildSkillPackV2Files(rules);
    const script = get(files, "joblit-skills-v2/scripts/validate.mjs");
    const readme = get(files, "joblit-skills-v2/scripts/README.md");
    expect(script.content).toContain("node:fs");
    expect(script.content).toContain("--target=");
    expect(readme.content).toContain("validate.mjs");
  });

  it("ships the canonical 9-gate quality gates document", () => {
    const qg = get(buildSkillPackV2Files(rules), "joblit-skills-v2/instructions/quality-gates.md");
    expect(qg.content).toContain("BULLET_PRESERVATION");
    expect(qg.content).toContain("WORD_COUNT_RANGE");
  });

  it("exports formal JSON schemas for resume and cover contracts", () => {
    const files = buildSkillPackV2Files(rules);
    const resumeSchema = JSON.parse(
      get(files, "joblit-skills-v2/schema/resume-output.schema.json").content,
    );
    const coverSchema = JSON.parse(
      get(files, "joblit-skills-v2/schema/cover-output.schema.json").content,
    );
    expect(resumeSchema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(resumeSchema.type).toBe("object");
    expect(coverSchema.type).toBe("object");
  });

  it("supports redacted skill pack context export", () => {
    const files = buildSkillPackV2Files(
      rules,
      {
        resumeSnapshot: {
          summary: "secret summary",
          experiences: [{ title: "Engineer", bullets: ["secret bullet"] }],
        },
        resumeSnapshotUpdatedAt: "2026-02-23T00:00:00.000Z",
      },
      { redactContext: true },
    );
    const parsed = JSON.parse(get(files, "joblit-skills-v2/context/resume-snapshot.json").content);
    expect(parsed.summary).toBe("[REDACTED]");
    expect(Array.isArray(parsed.experiences)).toBe(true);
    expect(parsed.experiences).toHaveLength(0);
  });

  it("produces a deterministic manifest (build stamp, not wall-clock)", () => {
    const a = JSON.parse(get(buildSkillPackV2Files(rules), "joblit-skills-v2/meta/manifest.json").content);
    const b = JSON.parse(get(buildSkillPackV2Files(rules), "joblit-skills-v2/meta/manifest.json").content);
    expect(a).toEqual(b); // identical across builds
    expect(a.packName).toBe("joblit-skills-v2");
    expect(typeof a.buildStamp).toBe("string");
    expect("generatedAt" in a).toBe(false);
    expect(a.files).toContain("joblit-skills-v2/meta/manifest.json");
  });

  it("no longer ships the removed thinner skill definitions", () => {
    const files = buildSkillPackV2Files(rules);
    expect(files.find((f) => f.name === "joblit-skills-v2/instructions/resume-skill.md")).toBeUndefined();
    expect(files.find((f) => f.name === "joblit-skills-v2/instructions/cover-skill.md")).toBeUndefined();
  });
});
