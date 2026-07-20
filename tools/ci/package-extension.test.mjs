import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { inspectExtensionTree } from "./package-extension.mjs";

async function fixture() {
  const parent = await mkdtemp(path.join(os.tmpdir(), "joblit-extension-"));
  const root = path.join(parent, "dist");
  await mkdir(path.join(root, "assets"), { recursive: true });
  await writeFile(
    path.join(root, "manifest.json"),
    JSON.stringify({ manifest_version: 3, version: "1.2.3" }),
  );
  await writeFile(path.join(root, "assets", "app.js"), "console.log('ok')\n");
  return { parent, root };
}

test("builds deterministic SHA-256 metadata from regular files", async (t) => {
  const item = await fixture();
  t.after(() => rm(item.parent, { recursive: true, force: true }));
  const first = await inspectExtensionTree(item.root, {
    expectedVersion: "1.2.3",
    sourceCommit: "a".repeat(40),
  });
  const second = await inspectExtensionTree(item.root, {
    expectedVersion: "1.2.3",
    sourceCommit: "a".repeat(40),
  });
  assert.deepEqual(first, second);
  assert.match(first.treeSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(
    first.files.map((file) => file.path),
    ["assets/app.js", "manifest.json"],
  );
});

test("rejects symlinks instead of archiving their targets", async (t) => {
  const item = await fixture();
  t.after(() => rm(item.parent, { recursive: true, force: true }));
  try {
    await symlink(
      path.join(item.root, "assets", "app.js"),
      path.join(item.root, "linked.js"),
    );
  } catch (error) {
    if (error?.code === "EPERM") {
      t.skip("Windows symlink privilege unavailable");
      return;
    }
    throw error;
  }
  await assert.rejects(
    inspectExtensionTree(item.root),
    /SYMLINK_FORBIDDEN/,
  );
});
