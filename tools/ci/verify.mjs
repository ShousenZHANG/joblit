#!/usr/bin/env node
/**
 * The single pre-push check. `npm run verify` exits 0 iff every gate a
 * contributor can run locally passes.
 *
 * CONTRIBUTING.md names this script rather than a checklist of commands, so
 * the contributor loop cannot drift from CI the way a hand-maintained list
 * does. The Runner suites use Node's built-in test runner and are excluded
 * from the root Vitest project, so they need their own step here.
 *
 * Deliberately excluded, because they need credentials or network:
 * `next build` and `npm run deps:audit`. CI (.github/workflows/ci.yml) runs
 * those on top of this set.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** @type {{ name: string, command: string, args: string[], cwd: string }[]} */
const STEPS = [
  { name: "typecheck", command: "npx", args: ["tsc", "--noEmit"], cwd: repoRoot },
  { name: "lint", command: "npm", args: ["run", "lint"], cwd: repoRoot },
  { name: "dependency policy", command: "npm", args: ["run", "deps:policy"], cwd: repoRoot },
  { name: "dead code", command: "npm", args: ["run", "deadcode"], cwd: repoRoot },
  { name: "tests", command: "npm", args: ["run", "test"], cwd: repoRoot },
  { name: "local companion", command: "node", args: ["--test", "tools/companion/*.test.mjs"], cwd: repoRoot },
];

function run(step) {
  return new Promise((resolve) => {
    const child = spawn(step.command, step.args, {
      cwd: step.cwd,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

const failed = [];
for (const step of STEPS) {
  process.stdout.write(`\n──── ${step.name} ────\n`);
  const code = await run(step);
  if (code !== 0) failed.push(step.name);
}

process.stdout.write("\n──── summary ────\n");
for (const step of STEPS) {
  process.stdout.write(`${failed.includes(step.name) ? "FAIL" : "ok  "}  ${step.name}\n`);
}

if (failed.length > 0) {
  process.stdout.write(`\n${failed.length} step(s) failed: ${failed.join(", ")}\n`);
  process.exit(1);
}
process.stdout.write("\nAll gates passed.\n");
