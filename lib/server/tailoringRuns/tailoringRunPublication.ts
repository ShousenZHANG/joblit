import type { Prisma } from "@/lib/generated/prisma";

import { completeBoundBatchTask } from "./tailoringBatchProjection";
import type {
  TailoringPublicationReceiptRow,
  TailoringReceiptRow,
  TailoringRunRow,
  TailoringRunTransaction,
} from "./tailoringRunDatabase";
import {
  assertBatchAttempt,
  assertRunMutable,
  readOwnedRun,
  validateHandle,
} from "./tailoringRunInternals";
import {
  acquireApplicationBatchLock,
  acquireTailoringJobLock,
  acquireTailoringRunLock,
} from "./tailoringRunLock";
import { TailoringRunError, targetMask } from "./tailoringRunProtocol";

export type TailoringPublicationRequest = {
  handle: { id: string; attemptId: string };
  applicationId: string;
  target: "RESUME" | "COVER";
  batchExecutionAttemptId?: string;
};

type PreparedTailoringPublication = {
  disposition: "PENDING" | "REPLAYED";
  run: TailoringRunRow;
  request: TailoringPublicationRequest;
  acceptedReceipt: TailoringReceiptRow;
  replayedReceipt?: TailoringPublicationReceiptRow;
};

function receiptForTarget(
  receipts: readonly TailoringReceiptRow[],
  target: "RESUME" | "COVER",
): TailoringReceiptRow {
  const receipt = receipts.find((item) => item.target === target);
  if (!receipt?.documentContentHash) {
    throw new TailoringRunError(
      "RECEIPT_CONFLICT",
      "The accepted target has no publishable content identity",
    );
  }
  return receipt;
}

function validatePublicationBinding(input: {
  run: TailoringRunRow;
  request: TailoringPublicationRequest;
  jobId: string;
  applicationId: string;
  acceptedReceipt: TailoringReceiptRow;
}): void {
  const { run, request, acceptedReceipt } = input;
  const bit = targetMask(request.target);
  if (run.jobId !== input.jobId || run.applicationId !== input.applicationId) {
    throw new TailoringRunError(
      "RECEIPT_CONFLICT",
      "Tailoring publication belongs to a different Application",
    );
  }
  if (
    (run.publicationRequiredTargetMask & bit) === 0 ||
    (run.acceptedTargetMask & bit) === 0
  ) {
    throw new TailoringRunError(
      "TARGET_NOT_REQUIRED",
      "Target is not ready for publication",
    );
  }
  if (
    acceptedReceipt.applicationId !== input.applicationId ||
    acceptedReceipt.delivery !== "DRAFT"
  ) {
    throw new TailoringRunError(
      "RECEIPT_CONFLICT",
      "The accepted target has an invalid Application binding",
    );
  }
}

export async function prepareTailoringRunPublication(
  tx: TailoringRunTransaction,
  input: {
    userId: string;
    jobId: string;
    applicationId: string;
    request: TailoringPublicationRequest;
  },
): Promise<PreparedTailoringPublication> {
  validateHandle(input.request.handle.id, input.request.handle.attemptId);
  await acquireTailoringJobLock(
    tx as unknown as Prisma.TransactionClient,
    input.userId,
    input.jobId,
  );
  const stale = await readOwnedRun(tx, input.userId, input.request.handle.id);
  const batchId = stale.applicationBatchTask?.batchId;
  if (batchId) {
    await acquireApplicationBatchLock(
      tx as unknown as Prisma.TransactionClient,
      batchId,
    );
  }
  await acquireTailoringRunLock(
    tx as unknown as Prisma.TransactionClient,
    stale.id,
  );
  const run = await readOwnedRun(tx, input.userId, stale.id);
  const acceptedReceipt = receiptForTarget(
    await tx.tailoringRunReceipt.findMany({
      where: { runId: run.id, target: input.request.target },
    }),
    input.request.target,
  );
  validatePublicationBinding({
    run,
    request: input.request,
    jobId: input.jobId,
    applicationId: input.applicationId,
    acceptedReceipt,
  });

  const replayedReceipt = (
    await tx.tailoringRunPublicationReceipt.findMany({
      where: { runId: run.id, target: input.request.target },
    })
  )[0];
  if (replayedReceipt) {
    if (
      replayedReceipt.applicationId !== input.applicationId ||
      replayedReceipt.documentContentHash !== acceptedReceipt.documentContentHash
    ) {
      throw new TailoringRunError(
        "RECEIPT_CONFLICT",
        "The target was already published with different content",
      );
    }
    return {
      disposition: "REPLAYED",
      run,
      request: input.request,
      acceptedReceipt,
      replayedReceipt,
    };
  }

  assertRunMutable(run);
  if (run.status !== "RUNNING") {
    throw new TailoringRunError("INVALID_STATE", "Tailoring run is not running");
  }
  if (run.executionAttemptId !== input.request.handle.attemptId) {
    throw new TailoringRunError(
      "ATTEMPT_STALE",
      "The tailoring attempt has been superseded",
    );
  }
  assertBatchAttempt(run, input.request.batchExecutionAttemptId);
  return { disposition: "PENDING", run, request: input.request, acceptedReceipt };
}

export async function completeTailoringRunPublication(
  tx: TailoringRunTransaction,
  input: {
    prepared: PreparedTailoringPublication;
    applicationId: string;
    documentContentHash: string;
  },
): Promise<{ completed: boolean; receipt: TailoringPublicationReceiptRow }> {
  const { prepared } = input;
  if (input.documentContentHash !== prepared.acceptedReceipt.documentContentHash) {
    throw new TailoringRunError(
      "RECEIPT_CONFLICT",
      "Published content does not match the accepted proposal",
    );
  }
  if (prepared.disposition === "REPLAYED" && prepared.replayedReceipt) {
    return {
      completed:
        prepared.run.publishedTargetMask ===
        prepared.run.publicationRequiredTargetMask,
      receipt: prepared.replayedReceipt,
    };
  }

  // The column is NOT NULL, but the run's attempt id is nullable — it is
  // cleared whenever an attempt is released or reclaimed. Publishing after that
  // happened would hand Prisma a null and raise a validation error with no
  // `code` at all, which reaches an agent client as an anonymous 500 and gets
  // replayed forever. It is a permanent fence violation, so say so.
  if (!prepared.run.executionAttemptId) {
    throw new TailoringRunError(
      "ATTEMPT_STALE",
      "This run has no live attempt to publish against. Generate this job again.",
    );
  }
  const receipt = await tx.tailoringRunPublicationReceipt.create({
    data: {
      runId: prepared.run.id,
      target: prepared.request.target,
      executionAttemptId: prepared.run.executionAttemptId,
      applicationId: input.applicationId,
      documentContentHash: input.documentContentHash,
    },
  });
  const mask =
    prepared.run.publishedTargetMask | targetMask(prepared.request.target);
  const completed =
    prepared.run.acceptedTargetMask === prepared.run.requiredTargetMask &&
    mask === prepared.run.publicationRequiredTargetMask;
  await tx.tailoringRun.update({
    where: { id: prepared.run.id },
    data: {
      publishedTargetMask: mask,
      ...(completed
        ? {
            status: "SUCCEEDED",
            terminalAt: new Date(),
            executionLeaseExpiresAt: null,
            errorCode: null,
            errorMessage: null,
          }
        : {}),
    },
  });
  if (completed && prepared.run.applicationBatchTask?.executionAttemptId) {
    await completeBoundBatchTask(
      tx,
      prepared.run.applicationBatchTask,
      prepared.run.applicationBatchTask.executionAttemptId,
      "SUCCEEDED",
      null,
    );
  }
  return { completed, receipt };
}
