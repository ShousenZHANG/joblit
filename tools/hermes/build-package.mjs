import { execFileSync } from "node:child_process";
import { lstat, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

import {
  MANIFEST_FILE,
  MANIFEST_SCHEMA_VERSION,
  PACKAGE_NAME,
  SECURITY_POLICY_HASH,
  canonicalJson,
  compareOrdinal,
  sha256Hex,
  validatePackageManifest,
  validateProfileSourceTree,
} from "./packagePolicy.mjs";

function buildError(code, detail) {
  const error = new Error(`${code}: ${detail}`);
  error.code = code;
  return error;
}

async function prepareStaging(stagingRoot) {
  await mkdir(stagingRoot, { recursive: true });
  const stagingStatus = await lstat(stagingRoot);
  if (stagingStatus.isSymbolicLink() || !stagingStatus.isDirectory()) {
    throw buildError("UNSAFE_STAGING_ROOT", "staging must be a real directory, not a symbolic link");
  }
  const entries = await readdir(stagingRoot);
  if (entries.length > 0) throw buildError("STAGING_NOT_EMPTY", stagingRoot);
}

function assertSeparateRoots(sourceRoot, stagingRoot) {
  const source = path.resolve(sourceRoot);
  const staging = path.resolve(stagingRoot);
  const relativeFromSource = path.relative(source, staging);
  const relativeFromStaging = path.relative(staging, source);
  if (
    source === staging ||
    (!relativeFromSource.startsWith("..") && !path.isAbsolute(relativeFromSource)) ||
    (!relativeFromStaging.startsWith("..") && !path.isAbsolute(relativeFromStaging))
  ) {
    throw buildError("OVERLAPPING_ROOTS", "source and staging must be separate trees");
  }
}

export async function buildPackage({ sourceRoot, stagingRoot, sourceCommit }) {
  if (!/^[a-f0-9]{40}$/.test(sourceCommit ?? "")) throw buildError("INVALID_SOURCE_COMMIT", String(sourceCommit));
  assertSeparateRoots(sourceRoot, stagingRoot);
  const source = await validateProfileSourceTree(sourceRoot);
  await prepareStaging(stagingRoot);

  for (const entry of source.entries) {
    const destination = path.join(stagingRoot, ...entry.path.split("/"));
    await mkdir(path.dirname(destination), { recursive: true });
    const bytes = await readFile(entry.absolutePath);
    await writeFile(destination, bytes, { flag: "wx", mode: 0o644 });
  }

  const files = [];
  for (const filePath of source.files) {
    const absolutePath = path.join(stagingRoot, ...filePath.split("/"));
    const [bytes, status] = await Promise.all([readFile(absolutePath), stat(absolutePath)]);
    files.push({ path: filePath, size: status.size, sha256: sha256Hex(bytes) });
  }
  files.sort((left, right) => compareOrdinal(left.path, right.path));
  const manifest = validatePackageManifest({
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    package: PACKAGE_NAME,
    profileVersion: source.distribution.version,
    hermesRequires: source.distribution.hermesRequires,
    sourceCommit,
    securityPolicyHash: SECURITY_POLICY_HASH,
    files,
  });
  await writeFile(path.join(stagingRoot, MANIFEST_FILE), canonicalJson(manifest), {
    encoding: "utf8",
    flag: "wx",
    mode: 0o644,
  });
  return { manifest, stagingRoot: path.resolve(stagingRoot) };
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--") || index + 1 >= argv.length) throw buildError("INVALID_ARGUMENT", argument);
    options[argument.slice(2)] = argv[index + 1];
    index += 1;
  }
  return options;
}

function gitOutput(repositoryRoot, args) {
  return execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!options.staging) throw buildError("STAGING_REQUIRED", "pass --staging <directory>");
  const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
  const sourceRoot = path.resolve(repositoryRoot, options.source ?? "integrations/hermes/profile");
  const relativeSource = path.relative(repositoryRoot, sourceRoot).split(path.sep).join("/");
  const dirty = gitOutput(repositoryRoot, ["status", "--porcelain=v1", "--", relativeSource]);
  if (dirty) throw buildError("DIRTY_PROFILE_SOURCE", dirty.split(/\r?\n/).join("; "));
  const sourceCommit = options["source-commit"] ?? gitOutput(repositoryRoot, ["rev-parse", "HEAD"]);
  const result = await buildPackage({
    sourceRoot,
    stagingRoot: path.resolve(repositoryRoot, options.staging),
    sourceCommit,
  });
  process.stdout.write(canonicalJson({ ok: true, stagingRoot: result.stagingRoot, manifest: result.manifest }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
