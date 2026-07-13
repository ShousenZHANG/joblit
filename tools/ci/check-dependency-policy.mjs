import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();
const policyPath = path.join(cwd, "tools", "ci", "dependency-allowlist.json");

const policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
const banned = new Set(policy.banned ?? []);
const violations = [];

function checkManifest(manifestPath, allowlist, workspace = ".") {
  const prefix = workspace === "." ? "" : `[${workspace}] `;
  if (!fs.existsSync(manifestPath)) {
    violations.push(`${prefix}package.json not found`);
    return;
  }

  const pkg = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const deps = Object.keys(pkg.dependencies ?? {});
  const devDeps = Object.keys(pkg.devDependencies ?? {});
  const allowDeps = new Set(allowlist?.dependencies ?? []);
  const allowDevDeps = new Set(allowlist?.devDependencies ?? []);

  for (const name of [...deps, ...devDeps]) {
    if (banned.has(name)) {
      violations.push(`${prefix}banned dependency detected: ${name}`);
    }
  }

  for (const name of deps) {
    if (!allowDeps.has(name)) {
      violations.push(`${prefix}dependency not in allowlist: ${name}`);
    }
  }

  for (const name of devDeps) {
    if (!allowDevDeps.has(name)) {
      violations.push(`${prefix}devDependency not in allowlist: ${name}`);
    }
  }

  for (const name of allowDeps) {
    if (!deps.includes(name)) {
      violations.push(`${prefix}stale allowlisted dependency: ${name}`);
    }
  }

  for (const name of allowDevDeps) {
    if (!devDeps.includes(name)) {
      violations.push(`${prefix}stale allowlisted devDependency: ${name}`);
    }
  }
}

checkManifest(path.join(cwd, "package.json"), policy.allowlist, ".");

for (const [workspace, config] of Object.entries(policy.workspaces ?? {})) {
  const workspaceRoot = path.resolve(cwd, workspace);
  const relativeRoot = path.relative(cwd, workspaceRoot);
  if (relativeRoot.startsWith("..") || path.isAbsolute(relativeRoot)) {
    violations.push(`[${workspace}] workspace path escapes repository root`);
    continue;
  }
  checkManifest(
    path.join(workspaceRoot, "package.json"),
    config.allowlist,
    workspace,
  );
}

if (violations.length) {
  console.error("Dependency policy check failed:");
  for (const msg of violations) {
    console.error(`- ${msg}`);
  }
  process.exit(1);
}

console.log("Dependency policy check passed.");
