import type { Prisma } from "@/lib/generated/prisma";

// Dedicated namespace for one user's mutations to one Job-backed Application.
// A hash collision only serializes unrelated work; it cannot weaken isolation.
const APPLICATION_MUTATION_LOCK_NAMESPACE = 0x4a4f4241; // "JOBA"

function stableInt32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash | 0;
}

/**
 * Serialize generated-content merges, autosaves, and destructive resets for
 * one user's job application.
 *
 * Acquire before reading or writing the Application. If a transaction also
 * needs a broader job/user lock, take that broader lock first; batch callers
 * must then take Application locks in sorted job-id order. `$executeRaw` is
 * required because PostgreSQL advisory locks return `void`, which Prisma
 * driver adapters cannot deserialize through `$queryRaw`.
 */
export async function acquireApplicationMutationLock(
  tx: Prisma.TransactionClient,
  userId: string,
  jobId: string,
): Promise<void> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      ${APPLICATION_MUTATION_LOCK_NAMESPACE}::integer,
      ${stableInt32(`${userId}:${jobId}`)}::integer
    )
  `;
}
