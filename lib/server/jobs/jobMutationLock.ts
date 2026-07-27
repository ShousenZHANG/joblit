import type { Prisma } from "@/lib/generated/prisma";
import { acquireAdvisoryLock } from "@/lib/server/db/advisoryLock";

/**
 * Serialize job imports and permanent deletes for one user.
 *
 * Must be the first database operation in the surrounding transaction, and — if
 * the transaction also takes the FetchRun lifecycle lock — second to it. See
 * `LOCK_ORDER` and ADR-0008.
 */
export async function acquireJobMutationLock(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  await acquireAdvisoryLock(tx, "jobMutation", userId);
}
