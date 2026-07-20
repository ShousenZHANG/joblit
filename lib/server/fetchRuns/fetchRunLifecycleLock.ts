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
