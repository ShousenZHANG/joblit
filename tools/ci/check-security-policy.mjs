import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { findDirectServerFetchCalls } from "./server-fetch-policy.mjs";

const cwd = process.cwd();
const violations = [];
const policy = JSON.parse(
  fs.readFileSync(path.join(cwd, "tools", "ci", "security-policy.json"), "utf8"),
);

function repositoryFiles() {
  const output = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    {
    cwd,
    encoding: "utf8",
    },
  );
  return output.split("\0").filter(Boolean);
}

function checkSensitiveFiles(files) {
  const scannerSource = "tools/ci/check-security-policy.mjs";
  const forbiddenPaths = [
    /(^|\/)\.env(?!\.example$)/i,
    /\.(?:key|pem|p12|pfx|jks|keystore)$/i,
    /(^|\/)releases\//i,
    /(^|\/)\.tmp\/hermes-/i,
    /hermes-receipt.*\.json$/i,
    /\.zip$/i,
  ];
  const secretTextPatterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /(?:^|[^A-Za-z0-9])ghp_[A-Za-z0-9]{20,}/,
    /(?:^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}/,
    /C:\\Users\\[^\\\s]+/i,
    /\/Users\/[^/\s]+/,
    /\/home\/(?!runner(?:\/|\b))[^/\s]+/,
  ];

  for (const relative of files) {
    const normalized = relative.replaceAll("\\", "/");
    if (forbiddenPaths.some((pattern) => pattern.test(normalized))) {
      violations.push(`sensitive or generated file is a commit candidate: ${normalized}`);
      continue;
    }

    const absolute = path.join(cwd, relative);
    let status;
    try {
      status = fs.lstatSync(absolute);
    } catch (error) {
      // `git ls-files` includes an unstaged deletion. The next commit removes
      // it, so there is no file content to inspect.
      if (error?.code === "ENOENT") continue;
      violations.push(`repository file is unreadable: ${normalized}`);
      continue;
    }
    if (status.isSymbolicLink()) {
      violations.push(`repository symlink is forbidden: ${normalized}`);
      continue;
    }
    if (
      !status.isFile() ||
      status.size > 1024 * 1024 ||
      normalized === scannerSource
    ) {
      continue;
    }
    const bytes = fs.readFileSync(absolute);
    if (bytes.includes(0)) continue;
    const text = bytes.toString("utf8");
    if (secretTextPatterns.some((pattern) => pattern.test(text))) {
      violations.push(`personal path or credential material found in: ${normalized}`);
    }
  }
}

function checkGitignore() {
  const lines = new Set(
    fs
      .readFileSync(path.join(cwd, ".gitignore"), "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  );
  for (const rule of policy.requiredGitignoreRules ?? []) {
    if (!lines.has(rule)) violations.push(`.gitignore missing required rule: ${rule}`);
  }
}

function checkServerOutboundFetch(files) {
  const config = policy.serverOutboundFetch ?? {};
  const roots = config.roots ?? [];
  const allowed = new Set(config.allowedDirectFetchFiles ?? []);

  for (const relative of files) {
    const normalized = relative.replaceAll("\\", "/");
    if (
      !roots.some((root) => normalized.startsWith(root)) ||
      allowed.has(normalized) ||
      /\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(normalized) ||
      !/\.[cm]?[jt]sx?$/i.test(normalized)
    ) {
      continue;
    }

    const absolute = path.join(cwd, relative);
    if (!fs.existsSync(absolute)) continue;
    const text = fs.readFileSync(absolute, "utf8");
    for (const call of findDirectServerFetchCalls(text, normalized)) {
      violations.push(
        `direct server fetch is forbidden: ${normalized}:${call.line}:${call.column}; use lib/server/net/safeFetch`,
      );
    }
  }
}

checkGitignore();
const files = repositoryFiles();
checkSensitiveFiles(files);
checkServerOutboundFetch(files);

if (violations.length) {
  console.error("Security policy check failed:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log("Security policy check passed.");
