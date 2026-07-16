import { createPrivateKey, sign } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { MANIFEST_FILE, SIGNATURE_FILE, canonicalJson } from "./packagePolicy.mjs";
import { verifyPackage } from "./verify-package.mjs";

function signingError(code, detail) {
  const error = new Error(`${code}: ${detail}`);
  error.code = code;
  return error;
}

export function createManifestSignature({ manifestBytes, privateKey, keyId }) {
  if (!Buffer.isBuffer(manifestBytes)) throw signingError("INVALID_MANIFEST_BYTES", "Buffer required");
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(keyId ?? "")) throw signingError("INVALID_KEY_ID", String(keyId));
  let key;
  try {
    key = privateKey?.type === "private" ? privateKey : createPrivateKey(privateKey);
  } catch (error) {
    throw signingError("INVALID_SIGNING_PRIVATE_KEY", error.message);
  }
  if (key.asymmetricKeyType !== "ed25519") throw signingError("INVALID_SIGNING_PRIVATE_KEY", "Ed25519 required");
  return {
    schemaVersion: 1,
    keyId,
    signature: sign(null, manifestBytes, key).toString("base64"),
  };
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--") || index + 1 >= argv.length) throw signingError("INVALID_ARGUMENT", argument);
    options[argument.slice(2)] = argv[index + 1];
    index += 1;
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!options.root || !options["key-id"]) throw signingError("MISSING_ARGUMENT", "--root and --key-id are required");
  const privateKey = process.env.JOBLIT_HERMES_SIGNING_PRIVATE_KEY;
  if (!privateKey) throw signingError("MISSING_SIGNING_PRIVATE_KEY", "JOBLIT_HERMES_SIGNING_PRIVATE_KEY is not set");
  await verifyPackage({ root: options.root, mode: "integrity", expectedSourceCommit: options["expected-source-commit"] });
  const manifestBytes = await readFile(path.join(options.root, MANIFEST_FILE));
  const signature = createManifestSignature({ manifestBytes, privateKey, keyId: options["key-id"] });
  const destination = path.join(options.root, SIGNATURE_FILE);
  const temporary = `${destination}.${process.pid}.tmp`;
  await writeFile(temporary, canonicalJson(signature), { encoding: "utf8", mode: 0o600, flag: "wx" });
  await rename(temporary, destination);
  process.stdout.write(canonicalJson({ ok: true, keyId: signature.keyId, signatureFile: SIGNATURE_FILE }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
