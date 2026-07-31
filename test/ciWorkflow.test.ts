import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  resolve(process.cwd(), ".github/workflows/ci.yml"),
  "utf8",
);

describe("CI workflow dependency order", () => {
  it("installs dependencies before Knip loads workspace configs", () => {
    const rootInstall = workflow.indexOf("- name: Install dependencies");
    const deadCodeGate = workflow.indexOf(
      "- name: Dead-code and dependency gate",
    );

    expect(rootInstall).toBeGreaterThan(-1);
    expect(deadCodeGate).toBeGreaterThan(-1);
    expect(rootInstall).toBeLessThan(deadCodeGate);
  });
});
