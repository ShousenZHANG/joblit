import type { Prisma } from "@/lib/generated/prisma";

// Dedicated two-int namespace for mutations that can change whether a job URL
// is visible to one user. It cannot collide with single-bigint advisory locks.
const JOB_MUTATION_LOCK_NAMESPACE = 0x4a4f424a; // "JOBJ"

function stableInt32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash | 0;
}

/**
 * Serialize job imports and permanent deletes for one user.
 *
 * Must be the first database operation in the surrounding transaction. Use
 * $executeRaw because pg_advisory_xact_lock returns PostgreSQL void, which
 * Prisma driver adapters cannot deserialize through $queryRaw.
 */
export async function acquireJobMutationLock(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      ${JOB_MUTATION_LOCK_NAMESPACE}::integer,
      ${stableInt32(userId)}::integer
    )
  `;
}
