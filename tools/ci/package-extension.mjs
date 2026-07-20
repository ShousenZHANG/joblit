import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MAX_FILES = 2_000;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_TOTAL_BYTES = 60 * 1024 * 1024;

function fail(code, detail) {
  const error = new Error(`${code}: ${detail}`);
  error.code = code;
  return error;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--") || !argv[index + 1]) {
      throw fail("INVALID_ARGUMENT", key);
    }
    out[key.slice(2)] = argv[index + 1];
    index += 1;
  }
  return out;
}

async function walk(root, relative = "") {
  const absolute = path.join(root, relative);
  const status = await lstat(absolute);
  if (status.isSymbolicLink()) throw fail("SYMLINK_FORBIDDEN", relative || ".");
  if (status.isFile()) return [relative.replaceAll("\\", "/")];
  if (!status.isDirectory()) throw fail("SPECIAL_FILE_FORBIDDEN", relative || ".");

  const names = await readdir(absolute);
  names.sort((left, right) => left.localeCompare(right, "en"));
  const files = [];
  for (const name of names) {
    if (name.includes("\n") || name.includes("\r") || name.includes("\0")) {
      throw fail("INVALID_FILENAME", name);
    }
    files.push(...(await walk(root, path.join(relative, name))));
  }
  return files;
}

export async function inspectExtensionTree(root, options = {}) {
  const absoluteRoot = path.resolve(root);
  const rootStatus = await lstat(absoluteRoot).catch((error) => {
    throw fail("EXTENSION_ROOT_UNREADABLE", error.message);
  });
  if (rootStatus.isSymbolicLink() || !rootStatus.isDirectory()) {
    throw fail("EXTENSION_ROOT_INVALID", absoluteRoot);
  }

  const paths = await walk(absoluteRoot);
  if (!paths.includes("manifest.json")) throw fail("MANIFEST_MISSING", absoluteRoot);
  if (paths.length > MAX_FILES) throw fail("TOO_MANY_FILES", paths.length);
  const caseFolded = new Set();
  const files = [];
  let totalSize = 0;

  for (const relative of paths) {
    const folded = relative.toLowerCase();
    if (caseFolded.has(folded)) throw fail("CASE_COLLISION", relative);
    caseFolded.add(folded);
    const absolute = path.join(absoluteRoot, ...relative.split("/"));
    const status = await lstat(absolute);
    if (status.isSymbolicLink() || !status.isFile()) {
      throw fail("NON_REGULAR_FILE", relative);
    }
    if (status.size > MAX_FILE_BYTES) throw fail("FILE_TOO_LARGE", relative);
    totalSize += status.size;
    if (totalSize > MAX_TOTAL_BYTES) throw fail("PACKAGE_TOO_LARGE", totalSize);
    const bytes = await readFile(absolute);
    files.push({ path: relative, size: status.size, sha256: sha256(bytes) });
  }

  const builtManifest = JSON.parse(
    await readFile(path.join(absoluteRoot, "manifest.json"), "utf8"),
  );
  const sourcePackage = JSON.parse(
    await readFile(
      path.join(absoluteRoot, "..", "package.json"),
      "utf8",
    ).catch(() => Buffer.from("{}")),
  );
  const expectedVersion = options.expectedVersion || sourcePackage.version;
  if (!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(String(builtManifest.version ?? ""))) {
    throw fail("INVALID_MANIFEST_VERSION", builtManifest.version);
  }
  if (expectedVersion && builtManifest.version !== expectedVersion) {
    throw fail(
      "VERSION_MISMATCH",
      `${builtManifest.version} != ${expectedVersion}`,
    );
  }

  const canonicalTree = files
    .map((file) => `${file.path}\0${file.size}\0${file.sha256}\n`)
    .join("");
  return {
    schemaVersion: 1,
    package: "joblit-chrome-extension",
    version: builtManifest.version,
    sourceCommit: options.sourceCommit || "local",
    symlinks: "reject",
    totalSize,
    treeSha256: sha256(Buffer.from(canonicalTree, "utf8")),
    files,
  };
}

export async function writeExtensionReleaseMetadata(options) {
  const manifest = await inspectExtensionTree(options.root, options);
  const manifestPath = path.resolve(options.manifest);
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  if (options.fileList) {
    const fileListPath = path.resolve(options.fileList);
    await mkdir(path.dirname(fileListPath), { recursive: true });
    await writeFile(
      fileListPath,
      `${manifest.files.map((file) => file.path).join("\n")}\n`,
      "utf8",
    );
  }
  return manifest;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.root || !args.manifest) {
    throw fail("MISSING_ARGUMENT", "--root and --manifest are required");
  }
  const manifest = await writeExtensionReleaseMetadata({
    root: args.root,
    manifest: args.manifest,
    fileList: args["file-list"],
    expectedVersion: args["expected-version"],
    sourceCommit: args["source-commit"],
  });
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      version: manifest.version,
      files: manifest.files.length,
      treeSha256: manifest.treeSha256,
    })}\n`,
  );
}
