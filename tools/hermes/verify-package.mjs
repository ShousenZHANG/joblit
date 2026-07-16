import { createPublicKey, verify as verifySignature } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

import {
  MANIFEST_FILE,
  MAX_ARCHIVE_SIZE,
  SIGNATURE_FILE,
  canonicalJson,
  compareSemver,
  loadDistributionManifest,
  loadInstalledDistributionManifest,
  sha256Hex,
  validateInstalledPackagedTree,
  validatePackageManifest,
  validatePackagedTree,
} from "./packagePolicy.mjs";

function verificationError(code, detail) {
  const error = new Error(`${code}: ${detail}`);
  error.code = code;
  return error;
}

function exactObjectKeys(value, expected, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw verificationError(code, "object required");
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) throw verificationError(code, `keys ${actual.join(",")}`);
}

function parseJsonBytes(bytes, code) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw verificationError(code, error.message);
  }
}

function decodeBase64Strict(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw verificationError("INVALID_SIGNATURE_ENCODING", "signature must be canonical base64");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length !== 64 || bytes.toString("base64") !== value) {
    throw verificationError("INVALID_SIGNATURE_ENCODING", "Ed25519 signature must be 64 bytes");
  }
  return bytes;
}

async function readTrustRegistry(registryPath) {
  const registry = parseJsonBytes(await readFile(registryPath), "INVALID_TRUST_REGISTRY");
  exactObjectKeys(registry, ["schemaVersion", "keys"], "INVALID_TRUST_REGISTRY");
  if (registry.schemaVersion !== 1 || !Array.isArray(registry.keys)) {
    throw verificationError("INVALID_TRUST_REGISTRY", "unsupported schema or keys");
  }
  if (registry.keys.length === 0) throw verificationError("NO_TRUSTED_RELEASE_KEY", registryPath);
  const seen = new Set();
  for (const key of registry.keys) {
    exactObjectKeys(
      key,
      ["id", "algorithm", "publicKey", "minimumProfileVersion", "maximumProfileVersion", "revoked"],
      "INVALID_RELEASE_KEY",
    );
    if (typeof key.id !== "string" || !/^[a-z0-9][a-z0-9._-]{2,63}$/.test(key.id)) throw verificationError("INVALID_RELEASE_KEY", "invalid id");
    if (seen.has(key.id)) throw verificationError("DUPLICATE_RELEASE_KEY", key.id);
    seen.add(key.id);
    if (key.algorithm !== "Ed25519" || typeof key.publicKey !== "string" || typeof key.revoked !== "boolean") {
      throw verificationError("INVALID_RELEASE_KEY", key.id);
    }
    try {
      const publicKey = createPublicKey(key.publicKey);
      if (publicKey.asymmetricKeyType !== "ed25519") throw new Error("not Ed25519");
    } catch (error) {
      throw verificationError("INVALID_RELEASE_KEY", `${key.id}: ${error.message}`);
    }
  }
  return registry;
}

async function verifyProductionSignature({ root, manifestBytes, manifest, trustRegistryPath }) {
  const signaturePath = path.join(root, SIGNATURE_FILE);
  const signature = parseJsonBytes(
    await readFile(signaturePath).catch(() => {
      throw verificationError("MISSING_MANIFEST_SIGNATURE", signaturePath);
    }),
    "INVALID_SIGNATURE_FILE",
  );
  exactObjectKeys(signature, ["schemaVersion", "keyId", "signature"], "INVALID_SIGNATURE_FILE");
  if (signature.schemaVersion !== 1 || typeof signature.keyId !== "string") {
    throw verificationError("INVALID_SIGNATURE_FILE", "unsupported schema or key ID");
  }
  const registry = await readTrustRegistry(trustRegistryPath);
  const key = registry.keys.find((candidate) => candidate.id === signature.keyId);
  if (!key) throw verificationError("UNKNOWN_RELEASE_KEY", signature.keyId);
  if (key.revoked) throw verificationError("REVOKED_RELEASE_KEY", signature.keyId);
  if (
    compareSemver(manifest.profileVersion, key.minimumProfileVersion) < 0 ||
    compareSemver(manifest.profileVersion, key.maximumProfileVersion) > 0
  ) {
    throw verificationError("KEY_VERSION_OUT_OF_RANGE", `${signature.keyId}: ${manifest.profileVersion}`);
  }
  const publicKey = createPublicKey(key.publicKey);
  const signatureBytes = decodeBase64Strict(signature.signature);
  if (!verifySignature(null, manifestBytes, publicKey, signatureBytes)) {
    throw verificationError("INVALID_MANIFEST_SIGNATURE", signature.keyId);
  }
  return signature.keyId;
}

export async function verifyPackage({
  root,
  mode = "production",
  trustRegistryPath = fileURLToPath(new URL("../../integrations/hermes/trust/release-keys.json", import.meta.url)),
  archivePath,
  expectedArchiveSha256,
  expectedSourceCommit,
  installed = false,
  expectedProfileName,
  expectedDistributionSource,
}) {
  if (!new Set(["integrity", "digest", "production"]).has(mode)) throw verificationError("INVALID_VERIFICATION_MODE", mode);
  const packageRoot = path.resolve(root);
  const tree = installed
    ? await validateInstalledPackagedTree(packageRoot, { allowSignature: true })
    : await validatePackagedTree(packageRoot, { allowSignature: true });
  const manifestBytes = await readFile(path.join(packageRoot, MANIFEST_FILE));
  const manifest = validatePackageManifest(parseJsonBytes(manifestBytes, "INVALID_PACKAGE_MANIFEST"));
  if (expectedSourceCommit && manifest.sourceCommit !== expectedSourceCommit) {
    throw verificationError("SOURCE_COMMIT_MISMATCH", `${manifest.sourceCommit} != ${expectedSourceCommit}`);
  }
  const distribution = installed
    ? await loadInstalledDistributionManifest(packageRoot, {
      expectedProfileName,
      expectedSource: expectedDistributionSource,
    })
    : await loadDistributionManifest(packageRoot);
  if (distribution.version !== manifest.profileVersion || distribution.hermesRequires !== manifest.hermesRequires) {
    throw verificationError("DISTRIBUTION_MANIFEST_MISMATCH", distribution.version);
  }

  const fileByPath = new Map(tree.files.map((entry) => [entry.path, entry]));
  for (const expected of manifest.files) {
    if (installed && expected.path === "distribution.yaml") continue;
    const actual = fileByPath.get(expected.path);
    if (!actual || actual.size !== expected.size) throw verificationError("FILE_SIZE_MISMATCH", expected.path);
    const digest = sha256Hex(await readFile(actual.absolutePath));
    if (digest !== expected.sha256) throw verificationError("FILE_HASH_MISMATCH", expected.path);
  }

  let trustLevel = "integrity-only";
  let keyId;
  let archiveSha256;
  if (mode === "digest") {
    if (!/^[a-f0-9]{64}$/.test(expectedArchiveSha256 ?? "")) {
      throw verificationError("EXPECTED_ARCHIVE_SHA256_REQUIRED", "pass exact lowercase SHA-256");
    }
    if (!archivePath) throw verificationError("ARCHIVE_REQUIRED", "digest mode verifies the original archive");
    const archiveStatus = await stat(archivePath);
    if (!archiveStatus.isFile() || archiveStatus.size > MAX_ARCHIVE_SIZE) throw verificationError("INVALID_ARCHIVE", archivePath);
    archiveSha256 = sha256Hex(await readFile(archivePath));
    if (archiveSha256 !== expectedArchiveSha256) throw verificationError("ARCHIVE_SHA256_MISMATCH", archiveSha256);
    trustLevel = "beta-digest";
  }
  if (mode === "production") {
    if (!tree.hasSignature) throw verificationError("MISSING_MANIFEST_SIGNATURE", SIGNATURE_FILE);
    keyId = await verifyProductionSignature({ root: packageRoot, manifestBytes, manifest, trustRegistryPath });
    trustLevel = "verified-release";
  }

  return {
    ok: true,
    package: manifest.package,
    profileVersion: manifest.profileVersion,
    hermesRequires: manifest.hermesRequires,
    sourceCommit: manifest.sourceCommit,
    trustLevel,
    ...(keyId ? { keyId } : {}),
    ...(archiveSha256 ? { archiveSha256 } : {}),
  };
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--") || index + 1 >= argv.length) throw verificationError("INVALID_ARGUMENT", argument);
    options[argument.slice(2)] = argv[index + 1];
    index += 1;
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!options.root) throw verificationError("ROOT_REQUIRED", "pass --root <directory>");
  const result = await verifyPackage({
    root: options.root,
    mode: options.mode ?? "production",
    trustRegistryPath: options["trust-registry"],
    archivePath: options.archive,
    expectedArchiveSha256: options["expected-archive-sha256"],
    expectedSourceCommit: options["expected-source-commit"],
    installed: options.installed === "true",
    expectedProfileName: options["expected-profile-name"],
    expectedDistributionSource: options["expected-distribution-source"],
  });
  process.stdout.write(canonicalJson(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
