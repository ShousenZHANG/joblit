import type { Prisma } from "@/lib/generated/prisma";
import { acquireAdvisoryLock } from "@/lib/server/db/advisoryLock";

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
  await acquireAdvisoryLock(tx, "applicationMutation", `${userId}:${jobId}`);
}
