import type { Prisma } from "@/lib/generated/prisma";

/**
 * Every PostgreSQL advisory lock Joblit takes, and the one key derivation they
 * share.
 *
 * Two facts made this worth centralising.
 *
 * The key function was copy-pasted into three modules. Its output is a lock
 * identity, so the copies must agree byte for byte forever: if one drifts, two
 * deployed instances take *different* locks for the same row and stop
 * serialising against each other. Nothing would fail loudly — the invariant
 * would just quietly stop holding, which is the worst way for a lock to break.
 *
 * The namespaces were declared next to their callers, so nothing checked they
 * were distinct. Two namespaces colliding would silently merge unrelated
 * critical sections; `LOCK_NAMESPACES` puts them in one table an assertion can
 * read.
 *
 * Ordering is the other half of the contract and cannot live in a type. Where
 * a transaction takes more than one of these, it must follow `LOCK_ORDER`.
 */

/**
 * FNV-1a, 32-bit, truncated to a signed int.
 *
 * The exact algorithm is load-bearing: it is the lock identity. Changing it —
 * even to something better distributed — means a rolling deploy runs two
 * versions that no longer serialise against each other. `advisoryLock.test.ts`
 * pins its output for that reason.
 */
export function stableInt32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash | 0;
}

/**
 * The classic two-int advisory namespaces. Each is the ASCII of its four-letter
 * tag, which keeps them readable in `pg_locks` during an incident.
 */
export const LOCK_NAMESPACES = {
  /** "FRUN" — one FetchRun's import/finalisation phase. */
  fetchRunLifecycle: 0x4652554e,
  /** "JOBJ" — one user's job imports and permanent deletes. */
  jobMutation: 0x4a4f424a,
  /** "JOBA" — one user's mutations to one Job-backed Application. */
  applicationMutation: 0x4a4f4241,
} as const;

export type LockNamespace = keyof typeof LOCK_NAMESPACES;

/**
 * The order a transaction must take these in when it needs more than one.
 *
 * Broadest scope first. A transaction holding the narrow lock while waiting for
 * the broad one, against another holding the reverse, is a deadlock — so the
 * order is a real invariant, not a style preference.
 *
 * ADR-0008 fixes the first pair for the FetchRun commit boundary.
 * `jobDeleteService` follows the second when it cascades a delete.
 */
export const LOCK_ORDER: readonly LockNamespace[] = [
  "fetchRunLifecycle",
  "jobMutation",
  "applicationMutation",
];

/** Take a two-int transaction-scoped advisory lock. */
export async function acquireAdvisoryLock(
  tx: Prisma.TransactionClient,
  namespace: LockNamespace,
  key: string,
): Promise<void> {
  // $executeRaw, not $queryRaw: pg_advisory_xact_lock returns PostgreSQL void,
  // which Prisma driver adapters cannot deserialize through $queryRaw.
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      ${LOCK_NAMESPACES[namespace]}::integer,
      ${stableInt32(key)}::integer
    )
  `;
}
