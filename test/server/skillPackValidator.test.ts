import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execPath } from "node:process";

import { buildSkillPackV3Files } from "@/lib/server/ai/skillPack";
import { getStructuredSkillRules } from "@/lib/server/ai/promptSkills";

function setupPack() {
  const files = buildSkillPackV3Files(getStructuredSkillRules("en-AU"));
  const script = files.find((file) =>
    file.name.endsWith("scripts/validate.mjs"),
  );
  if (!script) throw new Error("validate.mjs not shipped in pack");
  const dir = mkdtempSync(join(tmpdir(), "joblit-pack-"));
  const scriptPath = join(dir, "validate.mjs");
  writeFileSync(scriptPath, script.content, "utf8");
  return { dir, scriptPath };
}

function run(
  scriptPath: string,
  jsonPath: string,
  target: "resume" | "cover",
) {
  try {
    const out = execFileSync(
      execPath,
      [scriptPath, jsonPath, `--target=${target}`, "--locale=en-AU"],
      { encoding: "utf8", timeout: 15_000 },
    );
    return { code: 0, out };
  } catch (error) {
    const failure = error as {
      status?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      code: failure.status ?? 1,
      out: `${failure.stdout ?? ""}${failure.stderr ?? ""}`,
    };
  }
}

describe(
  "skill pack validate.mjs (deterministic output gate)",
  { retry: 2 },
  () => {
    it("passes a current resume output with zero added bullets", () => {
      const { dir, scriptPath } = setupPack();
      const good = join(dir, "good.json");
      writeFileSync(
        good,
        JSON.stringify({
          cvSummary: "Engineer with **AWS** and **Terraform** experience.",
          latestExperience: { addedBullets: [] },
        }),
      );

      const result = run(scriptPath, good, "resume");
      expect(result.code).toBe(0);
      expect(result.out).toContain("PASS");
    });

    it("fails resume output with target leak, skills, and more than three additions", () => {
      const { dir, scriptPath } = setupPack();
      const bad = join(dir, "bad.json");
      writeFileSync(
        bad,
        JSON.stringify({
          cvSummary: "Bad **summary ** marker",
          latestExperience: {
            addedBullets: ["one", "two", "three", "four"],
          },
          skillsFinal: [{ label: "Cloud", items: ["AWS"] }],
          cover: { paragraphOne: "leak" },
        }),
      );

      const result = run(scriptPath, bad, "resume");
      expect(result.code).toBe(1);
      expect(result.out).toContain("FAIL");
      expect(result.out).toContain("TARGET_LEAK");
      expect(result.out).toContain("ADDED_BULLETS_COUNT");
      expect(result.out).toContain("unexpected resume key");
    });

    it("fails cover output with fields beyond the three body paragraphs", () => {
      const { dir, scriptPath } = setupPack();
      const bad = join(dir, "cover-extra.json");
      writeFileSync(
        bad,
        JSON.stringify({
          cover: {
            paragraphOne: "First paragraph.",
            paragraphTwo: "Second paragraph.",
            paragraphThree: "Third paragraph.",
            subject: "Legacy metadata",
          },
        }),
      );

      const result = run(scriptPath, bad, "cover");
      expect(result.code).toBe(1);
      expect(result.out).toContain("unexpected cover key");
    });

    it("fails when output is wrapped in code fences instead of raw JSON", () => {
      const { dir, scriptPath } = setupPack();
      const fenced = join(dir, "fenced.json");
      writeFileSync(fenced, '```json\n{"cover":{}}\n```');

      const result = run(scriptPath, fenced, "cover");
      expect(result.code).toBe(1);
      expect(result.out).toContain("JSON_ONLY");
    });

    it("fails null and text values beyond the canonical schema limits", () => {
      const { dir, scriptPath } = setupPack();
      const nullOutput = join(dir, "null.json");
      const longResume = join(dir, "long-resume.json");
      const longCover = join(dir, "long-cover.json");
      writeFileSync(nullOutput, "null");
      writeFileSync(
        longResume,
        JSON.stringify({
          cvSummary: "x".repeat(2001),
          latestExperience: { addedBullets: [] },
        }),
      );
      writeFileSync(
        longCover,
        JSON.stringify({
          cover: {
            paragraphOne: "x".repeat(2001),
            paragraphTwo: "Evidence",
            paragraphThree: "Motivation",
          },
        }),
      );

      expect(run(scriptPath, nullOutput, "resume")).toMatchObject({
        code: 1,
      });
      expect(run(scriptPath, longResume, "resume")).toMatchObject({
        code: 1,
      });
      expect(run(scriptPath, longCover, "cover")).toMatchObject({
        code: 1,
      });
    });
  },
);
