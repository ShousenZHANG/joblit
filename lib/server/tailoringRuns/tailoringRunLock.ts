import type { Prisma } from "@/lib/generated/prisma";

const APPLICATION_BATCH_LOCK_NAMESPACE = 0x41424154; // "ABAT"
const TAILORING_RUN_LOCK_NAMESPACE = 0x544c524e; // "TLRN"

function stableInt32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash | 0;
}

export async function acquireApplicationBatchLock(
  tx: Prisma.TransactionClient,
  batchId: string,
): Promise<void> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      ${APPLICATION_BATCH_LOCK_NAMESPACE}::integer,
      ${stableInt32(batchId)}::integer
    )
  `;
}

export async function acquireTailoringRunLock(
  tx: Prisma.TransactionClient,
  runId: string,
): Promise<void> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      ${TAILORING_RUN_LOCK_NAMESPACE}::integer,
      ${stableInt32(runId)}::integer
    )
  `;
}

export async function acquireTailoringRunLocks(
  tx: Prisma.TransactionClient,
  runIds: readonly string[],
): Promise<void> {
  const sorted = Array.from(new Set(runIds)).sort();
  for (const runId of sorted) {
    await acquireTailoringRunLock(tx, runId);
  }
}
