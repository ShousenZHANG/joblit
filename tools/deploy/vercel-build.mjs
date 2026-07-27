import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { isPooledConnectionUrl, resolveMigrationUrl } from "./migrationUrl.mjs";

export function buildPlan(vercelEnvironment) {
  return vercelEnvironment === "production"
    ? ["db:migrate:deploy", "build"]
    : ["build"];
}

/**
 * Stop before a migration that cannot succeed.
 *
 * `prisma migrate deploy` serialises itself with a *session-scoped* advisory
 * lock. A transaction-mode pooler gives each statement whichever backend is
 * free, so migrate never observes its own lock and dies after ten seconds:
 *
 *   Timed out trying to acquire a postgres advisory lock
 *   (SELECT pg_advisory_lock(72707369)). Timeout: 10000ms.
 *   Please make sure your database server is running at the configured address.
 *
 * That last line sends you to check a database that is perfectly healthy. Name
 * the real cause here instead.
 */
function assertMigrationUrlIsDirect(env) {
  const url = resolveMigrationUrl(env);
  if (!isPooledConnectionUrl(url)) return;
  throw new Error(
    "Refusing to run migrations through a connection pooler: prisma migrate " +
      "needs a session-scoped advisory lock, which a pooled endpoint cannot " +
      "hold across statements, so the deploy would time out on " +
      "pg_advisory_lock(72707369). Set DIRECT_URL to the unpooled database " +
      "endpoint (Neon exposes it without the '-pooler' host suffix). " +
      "DATABASE_URL should stay pooled — the running app wants it.",
  );
}

function npmExecutable() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

export function runBuildPlan(
  vercelEnvironment = process.env.VERCEL_ENV,
  spawn = spawnSync,
  env = process.env,
) {
  const plan = buildPlan(vercelEnvironment);
  if (plan.includes("db:migrate:deploy")) assertMigrationUrlIsDirect(env);
  for (const script of plan) {
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
