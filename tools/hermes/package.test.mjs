import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildPackage } from "./build-package.mjs";
import {
  MAX_FILE_COUNT,
  MAX_FILE_SIZE,
  MAX_TOTAL_SIZE,
  assertNoCaseCollisions,
  enforceSizeLimits,
  validatePortableRelativePath,
  validateProfileSourceTree,
} from "./packagePolicy.mjs";
import { verifyPackage } from "./verify-package.mjs";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const canonicalSource = path.join(repositoryRoot, "integrations", "hermes", "profile");
const roots = [];
const commit = "0123456789abcdef0123456789abcdef01234567";

async function temporaryDirectory(prefix = "joblit-hermes-package-") {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function copySource() {
  const root = await temporaryDirectory("joblit-hermes-source-");
  await cp(canonicalSource, root, { recursive: true, errorOnExist: true });
  return root;
}

test.afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("builds byte-identical deterministic manifests from an allowlisted source", async () => {
  const source = await copySource();
  const stagingA = path.join(await temporaryDirectory(), "a");
  const stagingB = path.join(await temporaryDirectory(), "b");

  const first = await buildPackage({ sourceRoot: source, stagingRoot: stagingA, sourceCommit: commit });
  const second = await buildPackage({ sourceRoot: source, stagingRoot: stagingB, sourceCommit: commit });

  assert.deepEqual(first.manifest, second.manifest);
  assert.equal(
    await readFile(path.join(stagingA, "joblit-package-manifest.json"), "utf8"),
    await readFile(path.join(stagingB, "joblit-package-manifest.json"), "utf8"),
  );
  assert.deepEqual(
    first.manifest.files.map(({ path: filePath }) => filePath),
    [...first.manifest.files.map(({ path: filePath }) => filePath)].sort(),
  );
});

test("refuses a non-empty staging directory", async () => {
  const source = await copySource();
  const staging = await temporaryDirectory();
  await writeFile(path.join(staging, "stale.txt"), "stale", "utf8");

  await assert.rejects(
    buildPackage({ sourceRoot: source, stagingRoot: staging, sourceCommit: commit }),
    /STAGING_NOT_EMPTY/,
  );
});

test("verifies every declared hash and rejects missing, modified, or extra files", async (t) => {
  for (const mutation of ["missing", "modified", "extra"]) {
    await t.test(mutation, async () => {
      const source = await copySource();
      const staging = path.join(await temporaryDirectory(), "staging");
      await buildPackage({ sourceRoot: source, stagingRoot: staging, sourceCommit: commit });
      if (mutation === "missing") await rm(path.join(staging, "SOUL.md"));
      if (mutation === "modified") await writeFile(path.join(staging, "SOUL.md"), "tampered", "utf8");
      if (mutation === "extra") await writeFile(path.join(staging, "extra.txt"), "extra", "utf8");

      await assert.rejects(
        verifyPackage({ root: staging, mode: "integrity", expectedSourceCommit: commit }),
      );
    });
  }
});

test("verifies a stock-Hermes installed profile while allowing runtime-owned state", async () => {
  const source = await copySource();
  const installed = path.join(await temporaryDirectory(), "profiles", "joblit-0123456789abcdef");
  await buildPackage({ sourceRoot: source, stagingRoot: installed, sourceCommit: commit });
  const distributionSource = path.join(await temporaryDirectory(), "joblit-distributions", "joblit-0123456789abcdef", "current");
  await writeFile(
    path.join(installed, "distribution.yaml"),
    [
      "name: joblit-0123456789abcdef",
      "version: 0.2.0",
      "description: Grounded CV and cover-letter generation for Joblit through stock Hermes",
      "hermes_requires: '>=0.18.2'",
      "author: Joblit contributors",
      "license: Apache-2.0",
      "distribution_owned:",
      "- SOUL.md",
      "- config.yaml",
      "- .no-bundled-skills",
      "- skills/joblit-career-agent",
      `source: ${distributionSource}`,
      "installed_at: '2026-07-16T00:00:00+00:00'",
      "",
    ].join("\n"),
    "utf8",
  );
  await mkdir(path.join(installed, "sessions"), { recursive: true });
  await writeFile(path.join(installed, "sessions", "runtime.json"), "{}", "utf8");
  await writeFile(path.join(installed, ".env"), "API_SERVER_KEY=local-only\n", "utf8");

  await assert.doesNotReject(verifyPackage({
    root: installed,
    mode: "integrity",
    installed: true,
    expectedProfileName: "joblit-0123456789abcdef",
    expectedDistributionSource: distributionSource,
  }));

  await writeFile(path.join(installed, "SOUL.md"), "tampered", "utf8");
  await assert.rejects(
    verifyPackage({
      root: installed,
      mode: "integrity",
      installed: true,
      expectedProfileName: "joblit-0123456789abcdef",
      expectedDistributionSource: distributionSource,
    }),
    /FILE_(?:SIZE|HASH)_MISMATCH/,
  );
});

test("rejects wrong commits, schemas, policy hashes, and unsupported profile versions", async (t) => {
  const cases = [
    ["source commit", (manifest) => (manifest.sourceCommit = "f".repeat(40))],
    ["schema", (manifest) => (manifest.schemaVersion = 99)],
    ["policy", (manifest) => (manifest.securityPolicyHash = `sha256:${"0".repeat(64)}`)],
    ["version", (manifest) => (manifest.profileVersion = "9.0.0")],
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, async () => {
      const source = await copySource();
      const staging = path.join(await temporaryDirectory(), "staging");
      await buildPackage({ sourceRoot: source, stagingRoot: staging, sourceCommit: commit });
      const manifestPath = path.join(staging, "joblit-package-manifest.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      mutate(manifest);
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

      await assert.rejects(
        verifyPackage({ root: staging, mode: "integrity", expectedSourceCommit: commit }),
      );
    });
  }
});

test("rejects traversal, absolute, ADS, reserved, non-NFC, and malformed portable paths", () => {
  for (const filePath of [
    "../SOUL.md",
    "/SOUL.md",
    "C:/SOUL.md",
    "\\\\server\\share",
    "config.yaml:secret",
    "CON/config.yaml",
    "skills/../SOUL.md",
    "skills//SKILL.md",
    "skills/joblit .",
    "skills/cafe\u0301.md",
  ]) {
    assert.throws(() => validatePortableRelativePath(filePath));
  }
});

test("rejects case collisions before comparing an allowlist", () => {
  assert.throws(() => assertNoCaseCollisions(["SOUL.md", "soul.md"]), /case collision/i);
});

test("enforces file-count, per-file, and total-size caps", () => {
  assert.throws(
    () => enforceSizeLimits(Array.from({ length: MAX_FILE_COUNT + 1 }, (_, index) => ({ path: `${index}.md`, size: 1 }))),
    /FILE_COUNT_LIMIT/,
  );
  assert.throws(() => enforceSizeLimits([{ path: "large.md", size: MAX_FILE_SIZE + 1 }]), /FILE_SIZE_LIMIT/);
  assert.throws(
    () => enforceSizeLimits(Array.from({ length: 5 }, (_, index) => ({
      path: `${index}.md`,
      size: Math.floor(MAX_TOTAL_SIZE / 4),
    }))),
    /TOTAL_SIZE_LIMIT/,
  );
});

test("rejects unexpected source files, case collisions, and symbolic links", async (t) => {
  await t.test("unexpected", async () => {
    const source = await copySource();
    await writeFile(path.join(source, "unexpected.md"), "x", "utf8");
    await assert.rejects(validateProfileSourceTree(source), /UNEXPECTED_SOURCE_ENTRY/);
  });
  if (process.platform !== "win32") {
    await t.test("case collision", async () => {
      const source = await copySource();
      await writeFile(path.join(source, "soul.md"), "x", "utf8");
      await assert.rejects(validateProfileSourceTree(source), /case collision/i);
    });
  }
  if (process.platform !== "win32") {
    await t.test("symbolic link", async () => {
      const source = await copySource();
      await symlink(path.join(source, "SOUL.md"), path.join(source, "linked.md"));
      await assert.rejects(validateProfileSourceTree(source), /symbolic link/i);
    });
  }
});
