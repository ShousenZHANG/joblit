import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export function buildPlan(vercelEnvironment) {
  return vercelEnvironment === "production"
    ? ["db:migrate:deploy", "build"]
    : ["build"];
}

function npmExecutable() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

export function runBuildPlan(
  vercelEnvironment = process.env.VERCEL_ENV,
  spawn = spawnSync,
) {
  for (const script of buildPlan(vercelEnvironment)) {
    const result = spawn(npmExecutable(), ["run", script], {
      env: process.env,
      stdio: "inherit",
      shell: false,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(
        `Deployment step "npm run ${script}" failed with exit code ${result.status ?? "unknown"}.`,
      );
    }
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : null;

if (invokedPath === import.meta.url) {
  runBuildPlan();
}
