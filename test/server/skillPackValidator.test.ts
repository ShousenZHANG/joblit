import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execPath } from "node:process";

import { buildSkillPackV3Files } from "@/lib/server/ai/skillPack";
import { getStructuredSkillRules } from "@/lib/server/ai/promptSkills";

/** Inside the contract's 120-350 window, with one clean bold marker. */
const GOOD_SUMMARY =
  "Backend engineer with six years building **distributed** payment services in Go and TypeScript, including a ledger rewrite that cut settlement latency from 90 seconds to under 4.";

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
    it("passes a current resume output of summary plus index selection", () => {
      const { dir, scriptPath } = setupPack();
      const good = join(dir, "good.json");
      writeFileSync(
        good,
        JSON.stringify({
          cvSummary: GOOD_SUMMARY,
          skillsSelection: [
            { group: 0, items: [1, 0] },
            { group: 2, items: [3] },
          ],
        }),
      );

      const result = run(scriptPath, good, "resume");
      expect(result.code).toBe(0);
      expect(result.out).toContain("PASS");
    });

    it("fails resume output with a target leak, retired keys, and a short summary", () => {
      const { dir, scriptPath } = setupPack();
      const bad = join(dir, "bad.json");
      writeFileSync(
        bad,
        JSON.stringify({
          cvSummary: "Bad **summary ** marker",
          latestExperience: { addedBullets: ["one"] },
          skillsSelection: [{ group: 0, items: [0] }],
          cover: { paragraphOne: "leak" },
        }),
      );

      const result = run(scriptPath, bad, "resume");
      expect(result.code).toBe(1);
      expect(result.out).toContain("FAIL");
      expect(result.out).toContain("TARGET_LEAK");
      expect(result.out).toContain("SUMMARY_LENGTH");
      expect(result.out).toContain("BOLD_MARKERS");
      expect(result.out).toContain("unexpected resume key");
    });

    it("fails a selection that writes skill names instead of indexes", () => {
      const { dir, scriptPath } = setupPack();
      const bad = join(dir, "named-skills.json");
      writeFileSync(
        bad,
        JSON.stringify({
          cvSummary: GOOD_SUMMARY,
          skillsSelection: [{ group: 0, items: ["TypeScript"] }],
        }),
      );

      const result = run(scriptPath, bad, "resume");
      expect(result.code).toBe(1);
      expect(result.out).toContain("SELECTION_INDEX");
    });

    it("fails duplicate groups and duplicate indexes within a group", () => {
      const { dir, scriptPath } = setupPack();
      const bad = join(dir, "duplicates.json");
      writeFileSync(
        bad,
        JSON.stringify({
          cvSummary: GOOD_SUMMARY,
          skillsSelection: [
            { group: 1, items: [0, 0] },
            { group: 1, items: [2] },
          ],
        }),
      );

      const result = run(scriptPath, bad, "resume");
      expect(result.code).toBe(1);
      expect(result.out).toContain("SELECTION_DUPLICATE");
    });

    it("fails an empty selection and one with unexpected entry keys", () => {
      const { dir, scriptPath } = setupPack();
      const empty = join(dir, "empty-selection.json");
      const extraKey = join(dir, "extra-selection-key.json");
      writeFileSync(
        empty,
        JSON.stringify({ cvSummary: GOOD_SUMMARY, skillsSelection: [] }),
      );
      writeFileSync(
        extraKey,
        JSON.stringify({
          cvSummary: GOOD_SUMMARY,
          skillsSelection: [{ group: 0, items: [0], label: "Cloud" }],
        }),
      );

      expect(run(scriptPath, empty, "resume").out).toContain("SELECTION_SIZE");
      expect(run(scriptPath, extraKey, "resume").out).toContain(
        "has unexpected key(s): label",
      );
    });

    it("fails indexes that do not exist in a packaged skill bank", () => {
      const files = buildSkillPackV3Files(getStructuredSkillRules("en-AU"), {
        resumeSnapshot: {
          summary: "Backend engineer",
          skills: [{ category: "Backend", items: ["TypeScript", "Go"] }],
        },
        resumeSnapshotUpdatedAt: "2026-08-17T00:00:00.000Z",
      });
      const dir = mkdtempSync(join(tmpdir(), "joblit-pack-context-"));
      mkdirSync(join(dir, "scripts"));
      mkdirSync(join(dir, "context"));
      for (const name of ["scripts/validate.mjs", "context/resume-snapshot.json"]) {
        const file = files.find((candidate) => candidate.name.endsWith(name));
        if (!file) throw new Error(`missing skill pack file: ${name}`);
        writeFileSync(join(dir, name), file.content, "utf8");
      }
      const scriptPath = join(dir, "scripts", "validate.mjs");
      const bad = join(dir, "out-of-bank.json");
      writeFileSync(
        bad,
        JSON.stringify({
          cvSummary: GOOD_SUMMARY,
          skillsSelection: [{ group: 0, items: [5] }],
        }),
      );

      const result = run(scriptPath, bad, "resume");
      expect(result.code).toBe(1);
      expect(result.out).toContain("SELECTION_OUT_OF_BANK");
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
          skillsSelection: [{ group: 0, items: [0] }],
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
