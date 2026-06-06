import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execPath } from "node:process";

import { buildSkillPackV2Files } from "@/lib/server/ai/skillPack";
import { getStructuredSkillRules } from "@/lib/server/ai/promptSkills";

function setupPack() {
  const files = buildSkillPackV2Files(getStructuredSkillRules("en-AU"));
  const script = files.find((f) => f.name.endsWith("scripts/validate.mjs"));
  if (!script) throw new Error("validate.mjs not shipped in pack");
  const dir = mkdtempSync(join(tmpdir(), "joblit-pack-"));
  const scriptPath = join(dir, "validate.mjs");
  writeFileSync(scriptPath, script.content, "utf8");
  return { dir, scriptPath };
}

function run(scriptPath: string, jsonPath: string, target: "resume" | "cover") {
  try {
    const out = execFileSync(
      execPath,
      [scriptPath, jsonPath, `--target=${target}`, "--locale=en-AU"],
      { encoding: "utf8" },
    );
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

describe("skill pack validate.mjs (deterministic output gate)", () => {
  it("passes a well-formed resume output", () => {
    const { dir, scriptPath } = setupPack();
    const good = join(dir, "good.json");
    writeFileSync(
      good,
      JSON.stringify({
        cvSummary: "Engineer with **AWS** and **Terraform** experience.",
        latestExperience: { bullets: ["Built **Terraform** modules for multi-region AWS"] },
        skillsFinal: [{ label: "Cloud", items: ["AWS", "Terraform"] }],
      }),
    );
    const r = run(scriptPath, good, "resume");
    expect(r.code).toBe(0);
    expect(r.out).toContain("PASS");
  });

  it("fails resume output with cover leak, unclean bold, and >5 skill categories", () => {
    const { dir, scriptPath } = setupPack();
    const bad = join(dir, "bad.json");
    writeFileSync(
      bad,
      JSON.stringify({
        cvSummary: "Bad **summary ** marker",
        latestExperience: { bullets: ["x"] },
        skillsFinal: [1, 2, 3, 4, 5, 6].map((n) => ({ label: `c${n}`, items: ["a"] })),
        cover: { paragraphOne: "leak" },
      }),
    );
    const r = run(scriptPath, bad, "resume");
    expect(r.code).toBe(1);
    expect(r.out).toContain("FAIL");
    expect(r.out).toContain("TARGET_LEAK");
    expect(r.out).toContain("SKILLS_COUNT");
  });

  it("fails when output is wrapped in code fences instead of raw JSON", () => {
    const { dir, scriptPath } = setupPack();
    const fenced = join(dir, "fenced.json");
    writeFileSync(fenced, '```json\n{"cover":{}}\n```');
    const r = run(scriptPath, fenced, "cover");
    expect(r.code).toBe(1);
    expect(r.out).toContain("JSON_ONLY");
  });
});
