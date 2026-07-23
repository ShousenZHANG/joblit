import type { Prisma } from "@/lib/generated/prisma";

const FETCH_RUN_LIFECYCLE_LOCK_NAMESPACE = 0x4652554e; // "FRUN"

function stableInt32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash | 0;
}

/**
 * Serializes cancellation with the short import/finalization phase of one run.
 * Network fetching stays outside the lock; only the point of no return is
 * protected so Cancel either wins before import or observes a terminal run.
 */
export async function acquireFetchRunLifecycleLock(
  tx: Prisma.TransactionClient,
  runId: string,
): Promise<void> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      ${FETCH_RUN_LIFECYCLE_LOCK_NAMESPACE}::integer,
      ${stableInt32(runId)}::integer
    )
  `;
}

/**
 * Take the dispatch lock for one run, or report that another caller holds it.
 *
 * Distinct from the lifecycle lock above: this one is a *try* lock, so a second
 * concurrent trigger returns immediately with the canonical "already
 * dispatched" answer rather than queueing behind a call to GitHub.
 *
 * The key is a djb2 hash masked to 31 bits — positive, because some drivers
 * serialize a negative bigint oddly. Collisions across runIds are acceptable:
 * the worst case is two unrelated runs briefly serializing their trigger
 * calls. This lived inlined in the trigger route; it belongs next to the other
 * lock primitives, where the namespace choices can be compared.
 */
export function fetchRunDispatchKey(runId: string): number {
  let hash = 5381;
  for (let index = 0; index < runId.length; index += 1) {
    hash = ((hash << 5) + hash + runId.charCodeAt(index)) | 0;
  }
  return hash & 0x7fffffff;
}

export async function tryAcquireFetchRunDispatchLock(
  tx: Prisma.TransactionClient,
  runId: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<{ locked: boolean }[]>`
    SELECT pg_try_advisory_xact_lock(${fetchRunDispatchKey(runId)}::bigint) AS locked
  `;
  return rows?.[0]?.locked === true;
}
