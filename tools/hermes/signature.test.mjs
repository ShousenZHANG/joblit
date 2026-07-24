import assert from "node:assert/strict";
import {
  generateKeyPairSync,
  createHash,
} from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildPackage } from "./build-package.mjs";
import { createManifestSignature } from "./sign-manifest.mjs";
import { verifyPackage } from "./verify-package.mjs";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const sourceRoot = path.join(repositoryRoot, "integrations", "hermes", "profile");
const commit = "0123456789abcdef0123456789abcdef01234567";
const roots = [];

async function temporaryDirectory() {
  const root = await mkdtemp(path.join(tmpdir(), "joblit-hermes-signature-"));
  roots.push(root);
  return root;
}

async function fixture() {
  const root = await temporaryDirectory();
  const source = path.join(root, "source");
  const staging = path.join(root, "staging");
  await cp(sourceRoot, source, { recursive: true });
  await buildPackage({ sourceRoot: source, stagingRoot: staging, sourceCommit: commit });
  const manifestBytes = await readFile(path.join(staging, "joblit-package-manifest.json"));
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const signature = createManifestSignature({ manifestBytes, privateKey, keyId: "release-2026" });
  await writeFile(
    path.join(staging, "joblit-package-manifest.sig.json"),
    `${JSON.stringify(signature, null, 2)}\n`,
    "utf8",
  );
  return {
    root,
    staging,
    manifestBytes,
    privateKey,
    publicKey,
    signature,
  };
}

async function writeRegistry(root, keys) {
  const registryPath = path.join(root, "release-keys.json");
  await writeFile(registryPath, `${JSON.stringify({ schemaVersion: 1, keys }, null, 2)}\n`, "utf8");
  return registryPath;
}

function registryKey(publicKey, overrides = {}) {
  return {
    id: "release-2026",
    algorithm: "Ed25519",
    publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
    minimumProfileVersion: "0.2.0",
    maximumProfileVersion: "0.2.0",
    revoked: false,
    ...overrides,
  };
}

test.afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("verifies an ephemeral Ed25519 signature over exact manifest bytes", async () => {
  const item = await fixture();
  const trustRegistryPath = await writeRegistry(item.root, [registryKey(item.publicKey)]);

  const result = await verifyPackage({
    root: item.staging,
    mode: "production",
    trustRegistryPath,
    expectedSourceCommit: commit,
  });

  assert.equal(result.trustLevel, "verified-release");
  assert.equal(result.keyId, "release-2026");
});

test("fails closed for an empty trusted-key registry", async () => {
  const item = await fixture();
  const trustRegistryPath = await writeRegistry(item.root, []);

  await assert.rejects(
    verifyPackage({ root: item.staging, mode: "production", trustRegistryPath }),
    /NO_TRUSTED_RELEASE_KEY/,
  );
});

test("rejects modified manifest bytes and signatures from the wrong key", async (t) => {
  await t.test("modified manifest", async () => {
    const item = await fixture();
    const trustRegistryPath = await writeRegistry(item.root, [registryKey(item.publicKey)]);
    await writeFile(
      path.join(item.staging, "joblit-package-manifest.json"),
      Buffer.concat([item.manifestBytes, Buffer.from(" \n")]),
    );
    await assert.rejects(
      verifyPackage({ root: item.staging, mode: "production", trustRegistryPath }),
    );
  });
  await t.test("wrong key", async () => {
    const item = await fixture();
    const { publicKey: wrongPublicKey } = generateKeyPairSync("ed25519");
    const trustRegistryPath = await writeRegistry(item.root, [registryKey(wrongPublicKey)]);
    await assert.rejects(
      verifyPackage({ root: item.staging, mode: "production", trustRegistryPath }),
      /INVALID_MANIFEST_SIGNATURE/,
    );
  });
});

test("rejects unknown, revoked, duplicate, malformed, and out-of-range trusted keys", async (t) => {
  const scenarios = [
    ["unknown", (item) => [registryKey(item.publicKey, { id: "other" })], /UNKNOWN_RELEASE_KEY/],
    ["revoked", (item) => [registryKey(item.publicKey, { revoked: true })], /REVOKED_RELEASE_KEY/],
    ["duplicate", (item) => [registryKey(item.publicKey), registryKey(item.publicKey)], /DUPLICATE_RELEASE_KEY/],
    ["malformed", () => [{ id: "release-2026", algorithm: "Ed25519", publicKey: "invalid", revoked: false }], /INVALID_RELEASE_KEY/],
    [
      "out of range",
      (item) => [registryKey(item.publicKey, { minimumProfileVersion: "0.3.0", maximumProfileVersion: "0.9.0" })],
      /KEY_VERSION_OUT_OF_RANGE/,
    ],
  ];
  for (const [name, keys, expected] of scenarios) {
    await t.test(name, async () => {
      const item = await fixture();
      const trustRegistryPath = await writeRegistry(item.root, keys(item));
      await assert.rejects(
        verifyPackage({ root: item.staging, mode: "production", trustRegistryPath }),
        expected,
      );
    });
  }
});

test("rejects invalid signature encoding and non-Ed25519 keys", async (t) => {
  await t.test("encoding", async () => {
    const item = await fixture();
    const trustRegistryPath = await writeRegistry(item.root, [registryKey(item.publicKey)]);
    await writeFile(
      path.join(item.staging, "joblit-package-manifest.sig.json"),
      JSON.stringify({ schemaVersion: 1, keyId: "release-2026", signature: "%%%" }),
      "utf8",
    );
    await assert.rejects(
      verifyPackage({ root: item.staging, mode: "production", trustRegistryPath }),
      /INVALID_SIGNATURE_ENCODING/,
    );
  });
  await t.test("algorithm", async () => {
    const item = await fixture();
    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const trustRegistryPath = await writeRegistry(item.root, [registryKey(publicKey)]);
    await assert.rejects(
      verifyPackage({ root: item.staging, mode: "production", trustRegistryPath }),
      /INVALID_RELEASE_KEY/,
    );
  });
});

test("digest mode requires an explicit archive digest and never reports verified", async () => {
  const item = await fixture();
  const archivePath = path.join(item.root, "profile.zip");
  const archiveBytes = Buffer.from("test archive bytes");
  await writeFile(archivePath, archiveBytes);

  await assert.rejects(
    verifyPackage({ root: item.staging, mode: "digest", archivePath }),
    /EXPECTED_ARCHIVE_SHA256_REQUIRED/,
  );
  const digest = createHash("sha256").update(archiveBytes).digest("hex");
  const result = await verifyPackage({
    root: item.staging,
    mode: "digest",
    archivePath,
    expectedArchiveSha256: digest,
  });

  assert.equal(result.trustLevel, "beta-digest");
  assert.notEqual(result.trustLevel, "verified");
});
