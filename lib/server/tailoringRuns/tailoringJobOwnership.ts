import type { Prisma } from "@/lib/generated/prisma";
import {
  acquireTailoringJobLock,
  acquireTailoringRunLocks,
} from "./tailoringRunLock";
import { TailoringRunError } from "./tailoringRunProtocol";

export const STALE_ISSUED_TAILORING_RUN_MS = 30 * 60 * 1_000;

/**
 * Retire only abandoned standalone work while the caller holds TJOB.
 *
 * Batch runs keep their own durable reclaim protocol. A standalone RUNNING
 * run becomes replaceable only after its lease expires; an ISSUED run gets a
 * wider grace period for the prompt -> start hand-off. Replaying the same
 * issue key happens before this helper, so normal recovery is never cancelled.
 */
export async function retireStaleStandaloneTailoringRuns(
  tx: Prisma.TransactionClient,
  input: { userId: string; jobId: string; now: Date },
): Promise<void> {
  const stale = await tx.tailoringRun.findMany({
    where: {
      userId: input.userId,
      jobId: input.jobId,
      applicationBatchTaskId: null,
      acceptedTargetMask: 0,
      OR: [
        {
          status: "RUNNING",
          executionLeaseExpiresAt: { lte: input.now },
        },
        {
          status: "ISSUED",
          issuedAt: {
            lte: new Date(input.now.getTime() - STALE_ISSUED_TAILORING_RUN_MS),
          },
        },
      ],
    },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  if (stale.length === 0) return;

  await acquireTailoringRunLocks(
    tx,
    stale.map((run) => run.id),
  );
  // Re-evaluate every lease after TLRN. An old handle may have renewed while
  // this transaction was waiting for the run lock.
  await tx.tailoringRun.updateMany({
    where: {
      id: { in: stale.map((run) => run.id) },
      userId: input.userId,
      jobId: input.jobId,
      applicationBatchTaskId: null,
      acceptedTargetMask: 0,
      OR: [
        {
          status: "RUNNING",
          executionLeaseExpiresAt: { lte: input.now },
        },
        {
          status: "ISSUED",
          issuedAt: {
            lte: new Date(input.now.getTime() - STALE_ISSUED_TAILORING_RUN_MS),
          },
        },
      ],
    },
    data: {
      status: "CANCELLED",
      terminalAt: input.now,
      executionLeaseExpiresAt: null,
      errorCode: "STALE_GENERATION_SUPERSEDED",
      errorMessage: "An abandoned generation run was superseded",
    },
  });
}

export async function assertNoActiveTailoringRun(
  tx: Prisma.TransactionClient,
  input: { userId: string; jobId: string },
): Promise<void> {
  const active = await tx.tailoringRun.findFirst({
    where: {
      userId: input.userId,
      jobId: input.jobId,
      status: { in: ["ISSUED", "RUNNING"] },
    },
    select: { id: true },
  });
  if (active) {
    throw new TailoringRunError(
      "ATTEMPT_ACTIVE",
      "Another generation run already owns this Job",
    );
  }
}

/**
 * Guard a content write that is not proving authority with a TailoringRun.
 * Every such writer must call this before JOBA and keep the transaction open.
 */
export async function acquireUnboundApplicationWriteAuthority(
  tx: Prisma.TransactionClient,
  input: { userId: string; jobId: string; now?: Date },
): Promise<void> {
  await acquireTailoringJobLock(tx, input.userId, input.jobId);
  await retireStaleStandaloneTailoringRuns(tx, {
    userId: input.userId,
    jobId: input.jobId,
    now: input.now ?? new Date(),
  });
  await assertNoActiveTailoringRun(tx, input);
}
