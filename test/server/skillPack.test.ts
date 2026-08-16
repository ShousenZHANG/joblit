import { describe, expect, it } from "vitest";

import {
  buildSkillPackContentVersion,
  buildSkillPackV3Files,
} from "@/lib/server/ai/skillPack";
import {
  buildStructuredSkillRulesFromEffective,
  getStructuredSkillRules,
} from "@/lib/server/ai/promptSkills";
import {
  CV_SUMMARY_LENGTH,
  ResumeGenerationOutputSchema,
} from "@/lib/shared/schemas/applicationGenerationOutput";

const rules = getStructuredSkillRules("en-AU");

function get(files: { name: string; content: string }[], name: string) {
  const file = files.find((candidate) => candidate.name === name);
  if (!file) throw new Error(`missing skill pack file: ${name}`);
  return file;
}

describe("skill pack V3 (single source of truth)", () => {
  it("ships a root SKILL.md naming the joblit-tailoring skill and validator", () => {
    const skill = get(buildSkillPackV3Files(rules), "SKILL.md");
    expect(skill.content).toContain("name: joblit-tailoring");
    expect(skill.content).toContain("scripts/validate.mjs");
  });

  it("renders instructions/system.md from the canonical in-app builder", () => {
    const system = get(
      buildSkillPackV3Files(rules),
      "joblit-skills-v3/instructions/system.md",
    );
    expect(system.content).toContain("<role>");
    expect(system.content).toContain("<hard-constraints>");
    expect(system.content).toContain("<locale-profile>");
  });

  it("renders prompt templates with job placeholders and XML task tags", () => {
    const files = buildSkillPackV3Files(rules);
    const resume = get(
      files,
      "joblit-skills-v3/prompts/resume-job-prompt.template.md",
    );
    const cover = get(
      files,
      "joblit-skills-v3/prompts/cover-job-prompt.template.md",
    );
    expect(resume.content).toContain("{{JOB_TITLE}}");
    expect(resume.content).toContain("<task>");
    expect(resume.content).toContain("<self-check>");
    expect(cover.content).toContain("{{JOB_DESCRIPTION}}");
    expect(cover.content).toContain("<cover-structure>");
    expect(resume.content).not.toMatch(
      /\{\{(?:BASE_LATEST|TOP_RESPONSIBILITY|MISSING_RESPONSIBILITY|FALLBACK_RESPONSIBILITY)/,
    );
  });

  it("embeds the packaged candidate snapshot into both prompt templates", () => {
    const files = buildSkillPackV3Files(rules, {
      resumeSnapshot: {
        summary: "Backend engineer with grounded platform experience",
        experiences: [
          {
            title: "Engineer",
            company: "Acme",
            bullets: ["Built TypeScript APIs for enterprise workflows"],
          },
        ],
      },
      resumeSnapshotUpdatedAt: "2026-07-24T00:00:00.000Z",
    });
    const resume = get(
      files,
      "joblit-skills-v3/prompts/resume-job-prompt.template.md",
    );
    const cover = get(
      files,
      "joblit-skills-v3/prompts/cover-job-prompt.template.md",
    );

    expect(resume.content).toContain(
      "Backend engineer with grounded platform experience",
    );
    expect(resume.content).toContain(
      "Built TypeScript APIs for enterprise workflows",
    );
    expect(cover.content).toContain(
      "Backend engineer with grounded platform experience",
    );
    expect(resume.content).not.toContain("<candidate-evidence>\n{}");
    expect(cover.content).not.toContain("<candidate-evidence>\n{}");
  });

  it("ships the deterministic validator script and readme", () => {
    const files = buildSkillPackV3Files(rules);
    const script = get(files, "joblit-skills-v3/scripts/validate.mjs");
    const readme = get(files, "joblit-skills-v3/scripts/README.md");
    expect(script.content).toContain("node:fs");
    expect(script.content).toContain("--target=");
    expect(readme.content).toContain("validate.mjs");
  });

  it("ships the canonical quality gates document", () => {
    const qualityGates = get(
      buildSkillPackV3Files(rules),
      "joblit-skills-v3/instructions/quality-gates.md",
    );
    expect(qualityGates.content).toContain("SUMMARY_LENGTH");
    expect(qualityGates.content).toContain("TITLE_PRESENT");
    expect(qualityGates.content).toContain("SELECTION_INDEXES_ONLY");
    expect(qualityGates.content).toContain("SELECTION_IN_BANK");
    expect(qualityGates.content).toContain("WORD_COUNT_RANGE");
    expect(qualityGates.content).not.toContain("ADDITIONS_ONLY");
  });

  it("exports the current summary-plus-selection resume and three-paragraph cover schemas", () => {
    const files = buildSkillPackV3Files(rules);
    const resumeSchema = JSON.parse(
      get(files, "joblit-skills-v3/schema/resume-output.schema.json").content,
    );
    const coverSchema = JSON.parse(
      get(files, "joblit-skills-v3/schema/cover-output.schema.json").content,
    );

    expect(resumeSchema.$schema).toBe(
      "https://json-schema.org/draft/2020-12/schema",
    );
    expect(resumeSchema.required).toEqual(["cvSummary", "skillsSelection"]);
    expect(resumeSchema.properties).not.toHaveProperty("skillsFinal");
    expect(resumeSchema.properties).not.toHaveProperty("latestExperience");
    expect(resumeSchema.properties.cvSummary).toMatchObject({
      minLength: CV_SUMMARY_LENGTH.min,
      maxLength: CV_SUMMARY_LENGTH.max,
    });
    expect(resumeSchema.properties.skillsSelection.items.required).toEqual([
      "group",
      "items",
    ]);
    expect(
      resumeSchema.properties.skillsSelection.items.properties.group.type,
    ).toBe("integer");
    expect(
      resumeSchema.properties.skillsSelection.items.properties.items.items.type,
    ).toBe("integer");
    expect(Object.keys(coverSchema.properties.cover.properties).sort()).toEqual([
      "paragraphOne",
      "paragraphThree",
      "paragraphTwo",
    ]);
  });

  it("ships examples that exactly match the current contracts", () => {
    const files = buildSkillPackV3Files(rules);
    const resume = JSON.parse(
      get(files, "joblit-skills-v3/examples/resume-output.full.json").content,
    );
    const cover = JSON.parse(
      get(files, "joblit-skills-v3/examples/cover-output.full.json").content,
    );

    expect(
      ResumeGenerationOutputSchema.safeParse(resume).success,
    ).toBe(true);
    expect(Object.keys(resume).sort()).toEqual([
      "cvSummary",
      "skillsSelection",
    ]);
    expect(Object.keys(cover)).toEqual(["cover"]);
    expect(Object.keys(cover.cover).sort()).toEqual([
      "paragraphOne",
      "paragraphThree",
      "paragraphTwo",
    ]);
  });

  it("numbers the packaged skill bank inside the resume prompt template", () => {
    const files = buildSkillPackV3Files(rules, {
      resumeSnapshot: {
        summary: "Backend engineer",
        skills: [
          { category: "Backend", items: ["TypeScript", "Go"] },
          { category: "Cloud", items: ["AWS"] },
        ],
      },
      resumeSnapshotUpdatedAt: "2026-08-17T00:00:00.000Z",
    });
    const resume = get(
      files,
      "joblit-skills-v3/prompts/resume-job-prompt.template.md",
    );

    expect(resume.content).toContain("<skill-bank>");
    expect(resume.content).toContain('group 0: "Backend"');
    expect(resume.content).toContain("  1: Go");
    expect(resume.content).toContain('group 1: "Cloud"');
  });

  it("supports redacted skill pack context export", () => {
    const files = buildSkillPackV3Files(
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
    const parsed = JSON.parse(
      get(files, "joblit-skills-v3/context/resume-snapshot.json").content,
    );
    expect(parsed.summary).toBe("[REDACTED]");
    expect(parsed.experiences).toBeUndefined();
  });

  it("produces a deterministic V3 manifest", () => {
    const first = JSON.parse(
      get(
        buildSkillPackV3Files(rules),
        "joblit-skills-v3/meta/manifest.json",
      ).content,
    );
    const second = JSON.parse(
      get(
        buildSkillPackV3Files(rules),
        "joblit-skills-v3/meta/manifest.json",
      ).content,
    );

    expect(first).toEqual(second);
    expect(first.packName).toBe("joblit-skills-v3");
    expect(first.packVersion).toBe("3.0.0");
    expect(typeof first.buildStamp).toBe("string");
    expect("generatedAt" in first).toBe(false);
    expect(first.files).toContain("joblit-skills-v3/meta/manifest.json");
  });

  it("does not ship V2 paths or the removed thinner skill definitions", () => {
    const files = buildSkillPackV3Files(rules);
    expect(
      files.find(
        (file) =>
          file.name === "joblit-skills-v3/instructions/resume-skill.md",
      ),
    ).toBeUndefined();
    expect(
      files.find(
        (file) =>
          file.name === "joblit-skills-v3/instructions/cover-skill.md",
      ),
    ).toBeUndefined();
    expect(files.some((file) => file.name.startsWith("joblit-skills-v2/"))).toBe(
      false,
    );
  });

  it("converts the user's effective active rules without falling back to defaults", () => {
    const effective = buildStructuredSkillRulesFromEffective(
      {
        id: "active-template",
        locale: "en-AU",
        cvRules: ["active resume rule"],
        coverRules: ["active cover rule"],
        hardConstraints: ["active hard constraint"],
      },
      "zh-CN",
    );
    const files = buildSkillPackV3Files(effective, undefined, {
      locale: "zh-CN",
    });
    const resumeRules = JSON.parse(
      get(files, "joblit-skills-v3/rules/resume-rules.json").content,
    );
    const coverRules = JSON.parse(
      get(files, "joblit-skills-v3/rules/cover-rules.json").content,
    );
    const hardConstraints = JSON.parse(
      get(files, "joblit-skills-v3/rules/hard-constraints.json").content,
    );

    expect(
      resumeRules.rules.map((rule: { text: string }) => rule.text),
    ).toEqual(["active resume rule"]);
    expect(
      coverRules.rules.map((rule: { text: string }) => rule.text),
    ).toEqual(["active cover rule"]);
    expect(
      hardConstraints.rules.map((rule: { text: string }) => rule.text),
    ).toEqual(["active hard constraint"]);
    expect(resumeRules.version).toBe("3.0.0");
  });

  it("hashes final sorted file names and contents independent of input order", () => {
    const files = buildSkillPackV3Files(rules);
    const version = buildSkillPackContentVersion(files);

    expect(version).toHaveLength(64);
    expect(buildSkillPackContentVersion([...files].reverse())).toBe(version);
    expect(
      buildSkillPackContentVersion(
        files.map((file, index) =>
          index === 0
            ? { ...file, content: `${file.content}\nchanged` }
            : file,
        ),
      ),
    ).not.toBe(version);
  });
});
