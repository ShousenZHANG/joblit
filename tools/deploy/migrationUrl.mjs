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

/**
 * Names that already hold an unpooled URL, most explicit first.
 *
 * The Neon and Vercel Postgres integrations inject their own. If only a
 * standard Neon pooled URL exists, resolveMigrationUrl uses Neon's documented
 * `-pooler` host mapping; `DIRECT_URL` covers other manually wired providers.
 */
const DIRECT_URL_KEYS = [
  "DIRECT_URL",
  "DATABASE_URL_UNPOOLED",
  "POSTGRES_URL_NON_POOLING",
];

/** @param {Record<string, string | undefined>} env */
export function resolveMigrationUrl(env) {
  for (const key of DIRECT_URL_KEYS) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  const runtimeUrl = env.DATABASE_URL?.trim();
  if (!runtimeUrl) return runtimeUrl;

  // Neon documents pooled hosts as the same endpoint name with a `-pooler`
  // suffix. This is the only provider mapping we can derive without guessing.
  // Preserve credentials, port, database, TLS and channel-binding parameters.
  try {
    const parsed = new URL(runtimeUrl);
    if (
      (parsed.protocol === "postgres:" ||
        parsed.protocol === "postgresql:") &&
      parsed.hostname.includes("-pooler.") &&
      parsed.hostname.endsWith(".neon.tech")
    ) {
      parsed.hostname = parsed.hostname.replace("-pooler.", ".");
      return parsed.toString();
    }
  } catch {
    // Prisma will provide the actionable malformed-URL error.
  }
  return runtimeUrl;
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
  const hostname = parsed.hostname.toLowerCase();
  // Neon uses `-pooler`; Supabase and several managed Postgres providers use
  // a `pooler` or `pgbouncer` DNS label. These unknown-provider shapes must
  // fail closed and require an explicit direct URL instead of being mistaken
  // for a safe migration endpoint.
  if (/(^|[.-])(pooler|pgbouncer)([.-]|$)/.test(hostname)) return true;
  if (parsed.port === "6432" || parsed.port === "6543") return true;
  const pgbouncer = parsed.searchParams.get("pgbouncer")?.toLowerCase();
  return pgbouncer === "true" || pgbouncer === "1";
}
