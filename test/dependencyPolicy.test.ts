import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("dependency policy workspaces", () => {
  it("rejects an unreviewed Chrome extension dependency", () => {
    const root = mkdtempSync(join(tmpdir(), "joblit-dependency-policy-"));
    temporaryRoots.push(root);
    mkdirSync(join(root, "tools", "ci"), { recursive: true });
    mkdirSync(join(root, "chrome-extension"), { recursive: true });

    writeFileSync(join(root, "package.json"), JSON.stringify({ private: true }));
    writeFileSync(
      join(root, "chrome-extension", "package.json"),
      JSON.stringify({ dependencies: { "unreviewed-extension-sdk": "1.0.0" } }),
    );
    writeFileSync(
      join(root, "tools", "ci", "dependency-allowlist.json"),
      JSON.stringify({
        banned: [],
        allowlist: { dependencies: [], devDependencies: [] },
        workspaces: {
          "chrome-extension": {
            allowlist: { dependencies: [], devDependencies: [] },
          },
        },
      }),
    );

    const result = spawnSync(
      process.execPath,
      [resolve("tools/ci/check-dependency-policy.mjs")],
      { cwd: root, encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "[chrome-extension] dependency not in allowlist: unreviewed-extension-sdk",
    );
  });

  it("rejects dependencies that remain allowlisted after removal", () => {
    const root = mkdtempSync(join(tmpdir(), "joblit-dependency-policy-"));
    temporaryRoots.push(root);
    mkdirSync(join(root, "tools", "ci"), { recursive: true });

    writeFileSync(join(root, "package.json"), JSON.stringify({ private: true }));
    writeFileSync(
      join(root, "tools", "ci", "dependency-allowlist.json"),
      JSON.stringify({
        banned: [],
        allowlist: {
          dependencies: ["removed-production-package"],
          devDependencies: ["removed-development-package"],
        },
      }),
    );

    const result = spawnSync(
      process.execPath,
      [resolve("tools/ci/check-dependency-policy.mjs")],
      { cwd: root, encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "stale allowlisted dependency: removed-production-package",
    );
    expect(result.stderr).toContain(
      "stale allowlisted devDependency: removed-development-package",
    );
  });
});
