/**
 * Which connection `prisma migrate deploy` should use.
 *
 * Migrate serialises itself with a *session-scoped* advisory lock,
 * `pg_advisory_lock(72707369)`. A transaction-mode pooler routes each statement
 * to whichever backend is free, so the session that takes the lock is not the
 * one that later checks it, and every deploy waits out the 10s timeout:
 *
 *   Timed out trying to acquire a postgres advisory lock
 *   (SELECT pg_advisory_lock(72707369)). Timeout: 10000ms.
 *
 * Migrations need the direct endpoint. The application keeps using the pooled
 * one — that is what a serverless runtime wants, and its own locks are
 * transaction-scoped (`pg_advisory_xact_lock`), which a pooler handles fine.
 *
 * Plain `.mjs` with no imports so both `prisma.config.ts` and the Prisma CLI
 * can load it without a build step or path alias.
 */

/** @param {Record<string, string | undefined>} env */
export function resolveMigrationUrl(env) {
  const direct = env.DIRECT_URL?.trim();
  return direct ? direct : env.DATABASE_URL;
}

/**
 * True when a URL points at a connection pooler rather than the database.
 *
 * Used only to turn an opaque lock timeout into an actionable message; a
 * false negative just restores today's behaviour.
 *
 * @param {string | undefined} url
 */
export function isPooledConnectionUrl(url) {
  if (!url) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  // Neon names its pooled endpoint `<endpoint>-pooler.<region>...`.
  if (parsed.hostname.includes("-pooler.")) return true;
  return parsed.searchParams.get("pgbouncer") === "true";
}
