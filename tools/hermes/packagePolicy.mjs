import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";

export const MANIFEST_FILE = "joblit-package-manifest.json";
export const SIGNATURE_FILE = "joblit-package-manifest.sig.json";
export const PACKAGE_NAME = "joblit-hermes-profile";
export const MANIFEST_SCHEMA_VERSION = 1;
export const SUPPORTED_PROFILE_VERSION = "0.1.0";
export const SUPPORTED_HERMES_REQUIREMENT = ">=0.18.2";
export const MAX_FILE_COUNT = 32;
export const MAX_FILE_SIZE = 256 * 1024;
export const MAX_TOTAL_SIZE = 1024 * 1024;
export const MAX_ARCHIVE_SIZE = 2 * 1024 * 1024;

export const PROFILE_SOURCE_FILES = Object.freeze([
  ".no-bundled-skills",
  "SOUL.md",
  "config.yaml",
  "distribution.yaml",
  "skills/joblit-career-agent/SKILL.md",
  "skills/joblit-career-agent/references/grounding-policy.md",
  "skills/joblit-career-agent/references/output-contracts.md",
]);

export const DISTRIBUTION_OWNED = Object.freeze([
  "SOUL.md",
  "config.yaml",
  ".no-bundled-skills",
  "skills/joblit-career-agent",
]);

const PROFILE_DIRECTORIES = Object.freeze([
  "skills",
  "skills/joblit-career-agent",
  "skills/joblit-career-agent/references",
]);
const RESERVED_WINDOWS_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const FORBIDDEN_RUNTIME_NAMES = /(^|\/)(?:\.env(?:\.|$)|auth(?:\.|\/|$)|sessions?(?:\.|\/|$)|memory(?:\.|\/|$)|logs?(?:\.|\/|$)|trajector(?:y|ies)(?:\.|\/|$)|cache(?:\.|\/|$)|plugins?(?:\.|\/|$)|mcp(?:\.|\/|$))/i;
const FORBIDDEN_EXTENSIONS = /\.(?:exe|dll|com|msi|ps1|psm1|bat|cmd|sh|py|pyc|js|mjs|cjs|wasm|so|dylib|zip|tar|gz|7z)$/i;

function policyError(code, detail) {
  const error = new Error(`${code}: ${detail}`);
  error.code = code;
  return error;
}

export function compareOrdinal(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function validatePortableRelativePath(value) {
  if (typeof value !== "string" || value.length === 0) {
    throw policyError("INVALID_PATH", "path must be a non-empty string");
  }
  if (value.normalize("NFC") !== value) {
    throw policyError("NON_NFC_PATH", value);
  }
  if (/^[A-Za-z]:/.test(value) || value.startsWith("/") || value.startsWith("\\") || value.includes("\\")) {
    throw policyError("ABSOLUTE_OR_NON_PORTABLE_PATH", value);
  }
  if (value.includes(":")) {
    throw policyError("ALTERNATE_DATA_STREAM_PATH", value);
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw policyError("CONTROL_CHARACTER_PATH", value);
  }

  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw policyError("PATH_TRAVERSAL", value);
  }
  for (const segment of segments) {
    if (segment.endsWith(".") || segment.endsWith(" ")) {
      throw policyError("WINDOWS_TRAILING_CHARACTER", value);
    }
    if (RESERVED_WINDOWS_NAMES.test(segment)) {
      throw policyError("WINDOWS_RESERVED_NAME", value);
    }
  }
  return value;
}

export function assertNoCaseCollisions(paths) {
  const seen = new Map();
  for (const candidate of paths) {
    const portable = validatePortableRelativePath(candidate);
    const folded = portable.toLocaleLowerCase("en-US");
    const prior = seen.get(folded);
    if (prior && prior !== portable) {
      throw policyError("CASE_COLLISION", `case collision between ${prior} and ${portable}`);
    }
    seen.set(folded, portable);
  }
}

export function enforceSizeLimits(entries) {
  if (entries.length > MAX_FILE_COUNT) {
    throw policyError("FILE_COUNT_LIMIT", `${entries.length} exceeds ${MAX_FILE_COUNT}`);
  }
  let total = 0;
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.size) || entry.size < 0) {
      throw policyError("INVALID_FILE_SIZE", `${entry.path}: ${entry.size}`);
    }
    if (entry.size > MAX_FILE_SIZE) {
      throw policyError("FILE_SIZE_LIMIT", `${entry.path}: ${entry.size}`);
    }
    total += entry.size;
  }
  if (total > MAX_TOTAL_SIZE) {
    throw policyError("TOTAL_SIZE_LIMIT", `${total} exceeds ${MAX_TOTAL_SIZE}`);
  }
  return total;
}

async function walkTree(root) {
  const rootStatus = await lstat(root).catch((error) => {
    throw policyError("SOURCE_NOT_FOUND", `${root}: ${error.message}`);
  });
  if (rootStatus.isSymbolicLink() || !rootStatus.isDirectory()) {
    throw policyError("INVALID_ROOT", "root must be a real directory, not a symbolic link");
  }

  const files = [];
  const directories = [];
  async function visit(directory, relativeDirectory = "") {
    const items = await readdir(directory, { withFileTypes: true });
    items.sort((left, right) => compareOrdinal(left.name, right.name));
    for (const item of items) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${item.name}` : item.name;
      validatePortableRelativePath(relativePath);
      const absolutePath = path.join(directory, item.name);
      const status = await lstat(absolutePath);
      if (item.isSymbolicLink() || status.isSymbolicLink()) {
        throw policyError("SYMLINK_REJECTED", `symbolic link: ${relativePath}`);
      }
      if (item.isDirectory() && status.isDirectory()) {
        directories.push(relativePath);
        await visit(absolutePath, relativePath);
        continue;
      }
      if (!item.isFile() || !status.isFile()) {
        throw policyError("SPECIAL_FILE_REJECTED", relativePath);
      }
      files.push({ path: relativePath, size: status.size, absolutePath });
    }
  }
  await visit(root);
  files.sort((left, right) => compareOrdinal(left.path, right.path));
  directories.sort(compareOrdinal);
  assertNoCaseCollisions([...directories, ...files.map((entry) => entry.path)]);
  enforceSizeLimits(files);
  return { files, directories };
}

function assertExactSet(actual, expected, code) {
  const actualSorted = [...actual].sort(compareOrdinal);
  const expectedSorted = [...expected].sort(compareOrdinal);
  if (JSON.stringify(actualSorted) !== JSON.stringify(expectedSorted)) {
    const expectedSet = new Set(expectedSorted);
    const actualSet = new Set(actualSorted);
    const extra = actualSorted.filter((entry) => !expectedSet.has(entry));
    const missing = expectedSorted.filter((entry) => !actualSet.has(entry));
    throw policyError(code, `extra=[${extra.join(", ")}], missing=[${missing.join(", ")}]`);
  }
}

function assertNoForbiddenRuntimeEntry(filePath) {
  if (FORBIDDEN_RUNTIME_NAMES.test(filePath) || FORBIDDEN_EXTENSIONS.test(filePath)) {
    throw policyError("FORBIDDEN_RUNTIME_ENTRY", filePath);
  }
}

function yamlScalar(source, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`^${escaped}:\\s*(.+?)\\s*$`, "m"));
  if (!match) throw policyError("INVALID_DISTRIBUTION", `missing ${key}`);
  const value = match[1].trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function yamlStringList(source, key) {
  const lines = source.split(/\r?\n/);
  const index = lines.findIndex((line) => line.trim() === `${key}:`);
  if (index < 0) throw policyError("INVALID_DISTRIBUTION", `missing ${key}`);
  const values = [];
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    const line = lines[cursor];
    if (/^\S/.test(line)) break;
    const match = line.match(/^\s{2}-\s+(.+?)\s*$/);
    if (match) values.push(match[1].replace(/^['"]|['"]$/g, ""));
    else if (line.trim()) throw policyError("INVALID_DISTRIBUTION", `invalid ${key} item`);
  }
  return values;
}

export async function loadDistributionManifest(root) {
  const source = await readFile(path.join(root, "distribution.yaml"), "utf8");
  const topLevelKeys = source
    .split(/\r?\n/)
    .map((line) => /^([a-z_]+):(?:\s|$)/.exec(line)?.[1])
    .filter(Boolean);
  assertExactSet(
    topLevelKeys,
    ["name", "version", "description", "hermes_requires", "author", "license", "distribution_owned"],
    "INVALID_DISTRIBUTION_FIELDS",
  );
  const distribution = {
    name: yamlScalar(source, "name"),
    version: yamlScalar(source, "version"),
    description: yamlScalar(source, "description"),
    hermesRequires: yamlScalar(source, "hermes_requires"),
    author: yamlScalar(source, "author"),
    license: yamlScalar(source, "license"),
    distributionOwned: yamlStringList(source, "distribution_owned"),
  };
  if (distribution.name !== "joblit-local-ai") throw policyError("INVALID_DISTRIBUTION_NAME", distribution.name);
  if (distribution.version !== SUPPORTED_PROFILE_VERSION) throw policyError("UNSUPPORTED_PROFILE_VERSION", distribution.version);
  if (distribution.hermesRequires !== SUPPORTED_HERMES_REQUIREMENT) throw policyError("UNSUPPORTED_HERMES_REQUIREMENT", distribution.hermesRequires);
  if (distribution.author !== "Joblit contributors") throw policyError("INVALID_DISTRIBUTION_AUTHOR", distribution.author);
  if (distribution.license !== "Apache-2.0") throw policyError("INVALID_DISTRIBUTION_LICENSE", distribution.license);
  assertExactSet(distribution.distributionOwned, DISTRIBUTION_OWNED, "INVALID_DISTRIBUTION_OWNERSHIP");
  return distribution;
}

export async function validateProfileSourceTree(root) {
  const tree = await walkTree(root);
  for (const entry of tree.files) assertNoForbiddenRuntimeEntry(entry.path);
  assertExactSet(tree.files.map((entry) => entry.path), PROFILE_SOURCE_FILES, "UNEXPECTED_SOURCE_ENTRY");
  assertExactSet(tree.directories, PROFILE_DIRECTORIES, "UNEXPECTED_SOURCE_DIRECTORY");
  const distribution = await loadDistributionManifest(root);
  return {
    files: tree.files.map((entry) => entry.path),
    entries: tree.files,
    totalSize: tree.files.reduce((sum, entry) => sum + entry.size, 0),
    distribution,
  };
}

export const SECURITY_POLICY = Object.freeze({
  schemaVersion: 1,
  package: PACKAGE_NAME,
  allowedFiles: PROFILE_SOURCE_FILES,
  allowedDirectories: PROFILE_DIRECTORIES,
  forbiddenRuntimeNames: FORBIDDEN_RUNTIME_NAMES.source,
  forbiddenExtensions: FORBIDDEN_EXTENSIONS.source,
  maximumFileCount: MAX_FILE_COUNT,
  maximumFileSize: MAX_FILE_SIZE,
  maximumTotalSize: MAX_TOTAL_SIZE,
  pathNormalization: "NFC-forward-slash-case-unique-no-ADS-no-reserved-names",
  symlinks: "reject",
});

export const SECURITY_POLICY_HASH = `sha256:${sha256Hex(Buffer.from(JSON.stringify(SECURITY_POLICY), "utf8"))}`;

function assertObjectKeys(value, expected, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw policyError(code, "object required");
  assertExactSet(Object.keys(value), expected, code);
}

export function validatePackageManifest(manifest) {
  assertObjectKeys(
    manifest,
    ["schemaVersion", "package", "profileVersion", "hermesRequires", "sourceCommit", "securityPolicyHash", "files"],
    "INVALID_MANIFEST_SHAPE",
  );
  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) throw policyError("UNSUPPORTED_MANIFEST_SCHEMA", manifest.schemaVersion);
  if (manifest.package !== PACKAGE_NAME) throw policyError("INVALID_PACKAGE_NAME", manifest.package);
  if (manifest.profileVersion !== SUPPORTED_PROFILE_VERSION) throw policyError("UNSUPPORTED_PROFILE_VERSION", manifest.profileVersion);
  if (manifest.hermesRequires !== SUPPORTED_HERMES_REQUIREMENT) throw policyError("UNSUPPORTED_HERMES_REQUIREMENT", manifest.hermesRequires);
  if (!/^[a-f0-9]{40}$/.test(manifest.sourceCommit)) throw policyError("INVALID_SOURCE_COMMIT", manifest.sourceCommit);
  if (manifest.securityPolicyHash !== SECURITY_POLICY_HASH) throw policyError("SECURITY_POLICY_MISMATCH", manifest.securityPolicyHash);
  if (!Array.isArray(manifest.files)) throw policyError("INVALID_MANIFEST_FILES", "files must be an array");

  for (const entry of manifest.files) {
    assertObjectKeys(entry, ["path", "size", "sha256"], "INVALID_MANIFEST_FILE");
    validatePortableRelativePath(entry.path);
    if (!Number.isSafeInteger(entry.size) || entry.size < 0) throw policyError("INVALID_FILE_SIZE", entry.path);
    if (!/^[a-f0-9]{64}$/.test(entry.sha256)) throw policyError("INVALID_FILE_HASH", entry.path);
  }
  assertNoCaseCollisions(manifest.files.map((entry) => entry.path));
  enforceSizeLimits(manifest.files);
  assertExactSet(manifest.files.map((entry) => entry.path), PROFILE_SOURCE_FILES, "INVALID_MANIFEST_FILE_SET");
  const sorted = [...manifest.files].sort((left, right) => compareOrdinal(left.path, right.path));
  if (JSON.stringify(sorted) !== JSON.stringify(manifest.files)) throw policyError("UNSORTED_MANIFEST_FILES", "files must use ordinal path order");
  return manifest;
}

export async function validatePackagedTree(root, { allowSignature = true, allowLocalEnv = false } = {}) {
  const tree = await walkTree(root);
  const expectedFiles = [...PROFILE_SOURCE_FILES, MANIFEST_FILE];
  const hasSignature = tree.files.some((entry) => entry.path === SIGNATURE_FILE);
  if (hasSignature && allowSignature) expectedFiles.push(SIGNATURE_FILE);
  if (allowLocalEnv) expectedFiles.push(".env");
  assertExactSet(tree.files.map((entry) => entry.path), expectedFiles, "UNEXPECTED_PACKAGE_ENTRY");
  assertExactSet(tree.directories, PROFILE_DIRECTORIES, "UNEXPECTED_PACKAGE_DIRECTORY");
  return { ...tree, hasSignature };
}

export async function validateInstalledPackagedTree(root, { allowSignature = true } = {}) {
  const packageRoot = path.resolve(root);
  const rootStatus = await lstat(packageRoot).catch((error) => {
    throw policyError("SOURCE_NOT_FOUND", `${packageRoot}: ${error.message}`);
  });
  if (rootStatus.isSymbolicLink() || !rootStatus.isDirectory()) {
    throw policyError("INVALID_ROOT", "installed profile must be a real directory");
  }

  for (const forbidden of ["mcp.json", "plugins"] ) {
    const status = await lstat(path.join(packageRoot, forbidden)).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (status) throw policyError("FORBIDDEN_INSTALLED_ENTRY", forbidden);
  }

  const expectedFiles = [...PROFILE_SOURCE_FILES, MANIFEST_FILE];
  const signatureStatus = await lstat(path.join(packageRoot, SIGNATURE_FILE)).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  const hasSignature = Boolean(signatureStatus);
  if (hasSignature) {
    if (!allowSignature) throw policyError("UNEXPECTED_PACKAGE_ENTRY", SIGNATURE_FILE);
    expectedFiles.push(SIGNATURE_FILE);
  }

  const files = [];
  for (const filePath of expectedFiles) {
    const absolutePath = path.join(packageRoot, ...filePath.split("/"));
    const status = await lstat(absolutePath).catch((error) => {
      if (error.code === "ENOENT") throw policyError("MISSING_PACKAGE_FILE", filePath);
      throw error;
    });
    if (status.isSymbolicLink() || !status.isFile()) {
      throw policyError("INVALID_PACKAGE_FILE", filePath);
    }
    files.push({ path: filePath, size: status.size, absolutePath });
  }
  enforceSizeLimits(files);

  const skillsRoot = path.join(packageRoot, "skills");
  const skillsTree = await walkTree(skillsRoot);
  assertExactSet(
    skillsTree.files.map((entry) => `skills/${entry.path}`),
    PROFILE_SOURCE_FILES.filter((filePath) => filePath.startsWith("skills/")),
    "UNEXPECTED_INSTALLED_SKILL",
  );
  assertExactSet(
    skillsTree.directories.map((directory) => `skills/${directory}`),
    PROFILE_DIRECTORIES.filter((directory) => directory !== "skills"),
    "UNEXPECTED_INSTALLED_SKILL_DIRECTORY",
  );

  return { files, directories: [], hasSignature };
}

function installedYamlStringList(source, key) {
  const lines = source.split(/\r?\n/);
  const index = lines.findIndex((line) => line.trim() === `${key}:`);
  if (index < 0) throw policyError("INVALID_INSTALLED_DISTRIBUTION", `missing ${key}`);
  const values = [];
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    const line = lines[cursor];
    if (/^[a-z_]+:(?:\s|$)/.test(line)) break;
    const match = line.match(/^\s*-\s+(.+?)\s*$/);
    if (match) values.push(match[1].replace(/^['"]|['"]$/g, ""));
    else if (line.trim()) throw policyError("INVALID_INSTALLED_DISTRIBUTION", `invalid ${key} item`);
  }
  return values;
}

function sameAbsolutePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export async function loadInstalledDistributionManifest(root, { expectedProfileName, expectedSource } = {}) {
  if (!/^joblit-[a-f0-9]{16,64}$/.test(expectedProfileName ?? "")) {
    throw policyError("INVALID_EXPECTED_PROFILE_NAME", String(expectedProfileName));
  }
  if (typeof expectedSource !== "string" || !path.isAbsolute(expectedSource)) {
    throw policyError("INVALID_EXPECTED_DISTRIBUTION_SOURCE", String(expectedSource));
  }
  const source = await readFile(path.join(root, "distribution.yaml"), "utf8");
  const topLevelKeys = source
    .split(/\r?\n/)
    .map((line) => /^([a-z_]+):(?:\s|$)/.exec(line)?.[1])
    .filter(Boolean);
  assertExactSet(
    topLevelKeys,
    ["name", "version", "description", "hermes_requires", "author", "license", "distribution_owned", "source", "installed_at"],
    "INVALID_INSTALLED_DISTRIBUTION_FIELDS",
  );
  const distribution = {
    name: yamlScalar(source, "name"),
    version: yamlScalar(source, "version"),
    description: yamlScalar(source, "description"),
    hermesRequires: yamlScalar(source, "hermes_requires"),
    author: yamlScalar(source, "author"),
    license: yamlScalar(source, "license"),
    distributionOwned: installedYamlStringList(source, "distribution_owned"),
    source: yamlScalar(source, "source"),
    installedAt: yamlScalar(source, "installed_at"),
  };
  if (distribution.name !== expectedProfileName) throw policyError("INSTALLED_PROFILE_NAME_MISMATCH", distribution.name);
  if (distribution.version !== SUPPORTED_PROFILE_VERSION) throw policyError("UNSUPPORTED_PROFILE_VERSION", distribution.version);
  if (distribution.description !== "Grounded CV and cover-letter generation for Joblit through stock Hermes") {
    throw policyError("INVALID_DISTRIBUTION_DESCRIPTION", distribution.description);
  }
  if (distribution.hermesRequires !== SUPPORTED_HERMES_REQUIREMENT) throw policyError("UNSUPPORTED_HERMES_REQUIREMENT", distribution.hermesRequires);
  if (distribution.author !== "Joblit contributors") throw policyError("INVALID_DISTRIBUTION_AUTHOR", distribution.author);
  if (distribution.license !== "Apache-2.0") throw policyError("INVALID_DISTRIBUTION_LICENSE", distribution.license);
  assertExactSet(distribution.distributionOwned, DISTRIBUTION_OWNED, "INVALID_DISTRIBUTION_OWNERSHIP");
  if (!sameAbsolutePath(distribution.source, expectedSource)) {
    throw policyError("DISTRIBUTION_SOURCE_MISMATCH", distribution.source);
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(distribution.installedAt) || Number.isNaN(Date.parse(distribution.installedAt))) {
    throw policyError("INVALID_INSTALLED_AT", distribution.installedAt);
  }
  return distribution;
}

export function compareSemver(left, right) {
  const parse = (value) => {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
    if (!match) throw policyError("INVALID_SEMVER", value);
    return match.slice(1).map(Number);
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

export function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}
