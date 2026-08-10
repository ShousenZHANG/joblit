import { createHash } from "node:crypto";
import type { Prisma } from "@/lib/generated/prisma";
import {
  acquireApplicationBatchLock,
  acquireTailoringJobLock,
  acquireTailoringRunLocks,
} from "./tailoringRunLock";
import {
  TAILORING_RUN_PROTOCOL,
  TailoringRunError,
  targetMask,
} from "./tailoringRunProtocol";
import type {
  TailoringReceiptRow,
  TailoringRunRow,
  TailoringRunTransaction,
} from "./tailoringRunDatabase";
import {
  assertBatchAttempt,
  assertRunMutable,
  promptForTarget,
  readOwnedRun,
  validateHandle,
} from "./tailoringRunInternals";
import { completeBoundBatchTask } from "./tailoringBatchProjection";
import {
  assertSafeTailoringIdentity,
  hashTailoringRunValue,
} from "./tailoringRunHash";
import type {
  CompleteTailoringAcceptanceInput,
  CompletedTailoringAcceptance,
  PreparedTailoringAcceptance,
  PreparedTailoringRun,
  TailoringAcceptanceReplay,
  TailoringAcceptanceReplayProbe,
  TailoringAcceptanceReceipt,
  TailoringAcceptanceRequest,
} from "./tailoringRunTypes";

type LoadedRun = {
  run: TailoringRunRow;
  requests: TailoringAcceptanceRequest[];
};

type ReplayProbeDatabase = TailoringRunTransaction & {
  application: {
    findFirst(args: Record<string, unknown>): Promise<{
      id: string;
      status: string;
      aiContent: unknown;
      aiContentHash: string | null;
      resumePdfUrl: string | null;
      resumePdfName: string | null;
      coverPdfUrl: string | null;
      resumeContentHash: string | null;
      coverContentHash: string | null;
      resumePublishedHash: string | null;
      coverPublishedHash: string | null;
      job: {
        id: string;
        title: string;
        company: string | null;
        location: string | null;
        market: string;
      } | null;
      resumeProfile: {
        summary: string | null;
        basics: unknown;
        links: unknown;
        skills: unknown;
        experiences: unknown;
        projects: unknown;
        education: unknown;
      } | null;
    } | null>;
  };
};

const ACCEPTANCE_HASH_MAX_LENGTH = 256;

function validateAcceptanceHash(value: string, field: string): void {
  try {
    assertSafeTailoringIdentity(value);
  } catch {
    throw new TailoringRunError("RECEIPT_CONFLICT", `Invalid ${field}`);
  }
  if (
    !value ||
    value !== value.trim() ||
    value.length > ACCEPTANCE_HASH_MAX_LENGTH
  ) {
    throw new TailoringRunError("RECEIPT_CONFLICT", `Invalid ${field}`);
  }
}

function receiptOf(row: TailoringReceiptRow): TailoringAcceptanceReceipt {
  return {
    runId: row.runId,
    target: row.target,
    executionAttemptId: row.executionAttemptId,
    requestHash: row.requestHash,
    applicationId: row.applicationId,
    aiContentHash: row.aiContentHash,
    documentContentHash: row.documentContentHash,
    delivery: row.delivery,
  };
}

function acceptanceKey(runId: string, target: string): string {
  return `${runId}:${target}`;
}

/**
 * Canonical identity of one manual-generate acceptance command. Raw model
 * output never crosses the TailoringRun boundary; only its SHA-256 digest is
 * included in the durable request identity.
 */
export function hashManualTailoringAcceptance(input: {
  target: "RESUME" | "COVER";
  delivery: "DRAFT" | "FINAL";
  promptHash: string;
  modelOutput: string;
}): string {
  return hashTailoringRunValue({
    protocol: TAILORING_RUN_PROTOCOL,
    target: input.target === "RESUME" ? "resume" : "cover",
    delivery: input.delivery,
    promptHash: input.promptHash,
    outputHash: createHash("sha256").update(input.modelOutput).digest("hex"),
  });
}

function validateUniqueRequests(
  requests: readonly TailoringAcceptanceRequest[],
): void {
  const hashes = new Map<string, string>();
  for (const request of requests) {
    validateHandle(request.handle.id, request.handle.attemptId);
    validateAcceptanceHash(request.requestHash, "requestHash");
    const key = acceptanceKey(request.handle.id, request.target);
    const existing = hashes.get(key);
    if (existing && existing !== request.requestHash) {
      throw new TailoringRunError(
        "RECEIPT_CONFLICT",
        "One target has multiple acceptance payloads",
      );
    }
    hashes.set(key, request.requestHash);
  }
  if (hashes.size !== requests.length) {
    throw new TailoringRunError(
      "RECEIPT_CONFLICT",
      "Duplicate target acceptance request",
    );
  }
}

async function loadRuns(
  tx: TailoringRunTransaction,
  userId: string,
  requests: readonly TailoringAcceptanceRequest[],
): Promise<LoadedRun[]> {
  const grouped = new Map<string, TailoringAcceptanceRequest[]>();
  for (const request of requests) {
    const current = grouped.get(request.handle.id) ?? [];
    current.push(request);
    grouped.set(request.handle.id, current);
  }
  const loaded: LoadedRun[] = [];
  for (const [runId, runRequests] of grouped) {
    loaded.push({
      run: await readOwnedRun(tx, userId, runId),
      requests: runRequests,
    });
  }
  return loaded;
}

async function acquireAcceptanceLocks(
  tx: TailoringRunTransaction,
  loaded: readonly LoadedRun[],
): Promise<void> {
  const batchIds = Array.from(
    new Set(
      loaded
        .map((item) => item.run.applicationBatchTask?.batchId)
        .filter((id): id is string => Boolean(id)),
    ),
  ).sort();
  for (const batchId of batchIds) {
    await acquireApplicationBatchLock(
      tx as unknown as Prisma.TransactionClient,
      batchId,
    );
  }
  await acquireTailoringRunLocks(
    tx as unknown as Prisma.TransactionClient,
    loaded.map((item) => item.run.id),
  );
}

async function reloadRuns(
  tx: TailoringRunTransaction,
  userId: string,
  loaded: readonly LoadedRun[],
): Promise<LoadedRun[]> {
  const reloaded: LoadedRun[] = [];
  for (const item of loaded) {
    reloaded.push({
      run: await readOwnedRun(tx, userId, item.run.id),
      requests: item.requests,
    });
  }
  return reloaded;
}

async function readExistingReceipts(
  tx: TailoringRunTransaction,
  requests: readonly TailoringAcceptanceRequest[],
): Promise<Map<string, TailoringReceiptRow>> {
  const receipts = await tx.tailoringRunReceipt.findMany({
    where: {
      OR: requests.map((request) => ({
        runId: request.handle.id,
        target: request.target,
      })),
    },
  });
  return new Map(
    receipts.map((receipt) => [
      acceptanceKey(receipt.runId, receipt.target),
      receipt,
    ]),
  );
}

function checkReceiptReplay(
  request: TailoringAcceptanceRequest,
  receipts: ReadonlyMap<string, TailoringReceiptRow>,
): TailoringAcceptanceReceipt | null {
  const receipt = receipts.get(
    acceptanceKey(request.handle.id, request.target),
  );
  if (!receipt) return null;
  if (receipt.requestHash !== request.requestHash) {
    throw new TailoringRunError(
      "RECEIPT_CONFLICT",
      "The target was already accepted with different content",
    );
  }
  return receiptOf(receipt);
}

function validateReplayBinding(
  run: TailoringRunRow,
  request: TailoringAcceptanceReplayProbe,
): void {
  if (run.source !== request.source) {
    throw new TailoringRunError("SOURCE_MISMATCH", "Tailoring source mismatch");
  }
  if (run.delivery !== request.delivery) {
    throw new TailoringRunError(
      "DELIVERY_MISMATCH",
      "Tailoring delivery mismatch",
    );
  }
  const bit = targetMask(request.target);
  if ((run.requiredTargetMask & bit) === 0) {
    throw new TailoringRunError(
      "TARGET_NOT_REQUIRED",
      "Target is not required by this run",
    );
  }
  const prompt = promptForTarget(run, request.target);
  if (prompt.promptHash !== request.promptHash) {
    throw new TailoringRunError(
      "PROMPT_HASH_MISMATCH",
      "Target prompt hash does not match",
    );
  }
}

/**
 * Read-only fast path for a response-loss retry.
 *
 * This runs after authentication and body/prompt-receipt structure validation,
 * but before rate limiting or any current Job, Resume Profile, prompt,
 * renderer, or Blob dependency. Only an owned run and an immutable receipt
 * with the exact canonical request hash can replay. A missing receipt returns
 * null and leaves the full first-acceptance path unchanged.
 */
export async function probeTailoringRunAcceptanceReplay(
  database: ReplayProbeDatabase,
  input: {
    userId: string;
    jobId: string;
    request: TailoringAcceptanceReplayProbe;
  },
): Promise<TailoringAcceptanceReplay | null> {
  const { request } = input;
  validateHandle(request.handle.id, request.handle.attemptId);
  validateAcceptanceHash(request.requestHash, "requestHash");
  validateAcceptanceHash(request.promptHash, "promptHash");

  const run = await readOwnedRun(database, input.userId, request.handle.id);
  validateAggregateBinding([{ run, requests: [] }], input.jobId, undefined);
  validateReplayBinding(run, request);

  const receipt = (
    await database.tailoringRunReceipt.findMany({
      where: { runId: run.id, target: request.target },
    })
  )[0];
  if (!receipt) return null;
  if (receipt.requestHash !== request.requestHash) {
    throw new TailoringRunError(
      "RECEIPT_CONFLICT",
      "The target was already accepted with different content",
    );
  }
  if (
    receipt.delivery !== request.delivery ||
    !receipt.applicationId ||
    run.applicationId !== receipt.applicationId ||
    (run.acceptedTargetMask & targetMask(request.target)) === 0
  ) {
    throw new TailoringRunError(
      "RECEIPT_CONFLICT",
      "The acceptance receipt has an invalid Application binding",
    );
  }

  const application = await database.application.findFirst({
    where: {
      id: receipt.applicationId,
      userId: input.userId,
      jobId: input.jobId,
    },
    select: {
      id: true,
      status: true,
      aiContent: true,
      aiContentHash: true,
      resumePdfUrl: true,
      resumePdfName: true,
      coverPdfUrl: true,
      resumeContentHash: true,
      coverContentHash: true,
      resumePublishedHash: true,
      coverPublishedHash: true,
      job: {
        select: {
          id: true,
          title: true,
          company: true,
          location: true,
          market: true,
        },
      },
      resumeProfile: {
        select: {
          summary: true,
          basics: true,
          links: true,
          skills: true,
          experiences: true,
          projects: true,
          education: true,
        },
      },
    },
  });
  if (
    !application ||
    (application.status !== "DRAFT" && application.status !== "FINAL") ||
    application.aiContent == null ||
    !application.aiContentHash ||
    !application.job ||
    application.job.id !== input.jobId
  ) {
    throw new TailoringRunError(
      "RECEIPT_CONFLICT",
      "The accepted Application is unavailable",
    );
  }
  validateAcceptanceHash(application.aiContentHash, "aiContentHash");

  return {
    receipt: receiptOf(receipt),
    application: {
      id: application.id,
      status: application.status,
      aiContent: application.aiContent,
      aiContentHash: application.aiContentHash,
      resumePdfUrl: application.resumePdfUrl,
      resumePdfName: application.resumePdfName,
      coverPdfUrl: application.coverPdfUrl,
      resumeContentHash: application.resumeContentHash,
      coverContentHash: application.coverContentHash,
      resumePublishedHash: application.resumePublishedHash,
      coverPublishedHash: application.coverPublishedHash,
      job: application.job,
      resumeProfile: application.resumeProfile,
    },
  };
}

function validatePendingRequest(
  run: TailoringRunRow,
  request: TailoringAcceptanceRequest,
): void {
  assertRunMutable(run);
  if (run.status !== "RUNNING") {
    throw new TailoringRunError(
      "INVALID_STATE",
      "Tailoring run is not running",
    );
  }
  if (run.executionAttemptId !== request.handle.attemptId) {
    throw new TailoringRunError(
      "ATTEMPT_STALE",
      "The tailoring attempt has been superseded",
    );
  }
  if (run.source !== request.source) {
    throw new TailoringRunError("SOURCE_MISMATCH", "Tailoring source mismatch");
  }
  if (run.delivery !== request.delivery) {
    throw new TailoringRunError(
      "DELIVERY_MISMATCH",
      "Tailoring delivery mismatch",
    );
  }
  validateTargetBinding(run, request);
  validateAcceptanceSnapshots(run, request);
  assertBatchAttempt(run, request.batchExecutionAttemptId);
}

function validateTargetBinding(
  run: TailoringRunRow,
  request: TailoringAcceptanceRequest,
): void {
  const bit = targetMask(request.target);
  if ((run.requiredTargetMask & bit) === 0) {
    throw new TailoringRunError(
      "TARGET_NOT_REQUIRED",
      "Target is not required by this run",
    );
  }
  if ((run.acceptedTargetMask & bit) !== 0) {
    throw new TailoringRunError(
      "TARGET_ALREADY_ACCEPTED",
      "Target has already been accepted",
    );
  }
  const prompt = promptForTarget(run, request.target);
  if (prompt.promptHash !== request.promptHash) {
    throw new TailoringRunError(
      "PROMPT_HASH_MISMATCH",
      "Target prompt hash does not match",
    );
  }
}

function validateAcceptanceSnapshots(
  run: TailoringRunRow,
  request: TailoringAcceptanceRequest,
): void {
  if (
    run.resumeSnapshotHash !== request.resumeSnapshotHash ||
    run.jobSnapshotHash !== request.jobSnapshotHash
  ) {
    throw new TailoringRunError(
      "SNAPSHOT_MISMATCH",
      "Tailoring input snapshot does not match",
    );
  }
}

function preparedRunOf(run: TailoringRunRow): PreparedTailoringRun {
  if (!run.executionAttemptId) {
    throw new TailoringRunError(
      "INVALID_STATE",
      "Tailoring run has no execution attempt",
    );
  }
  const task = run.applicationBatchTask ?? null;
  return {
    id: run.id,
    source: run.source,
    delivery: run.delivery,
    requiredTargetMask: run.requiredTargetMask,
    acceptedTargetMask: run.acceptedTargetMask,
    publicationRequiredTargetMask: run.publicationRequiredTargetMask ?? 0,
    publishedTargetMask: run.publishedTargetMask ?? 0,
    executionAttemptId: run.executionAttemptId,
    applicationBatchTaskId: run.applicationBatchTaskId,
    batchId: task?.batchId ?? null,
    batchExecutionAttemptId: task?.executionAttemptId ?? null,
    batchTask: task,
  };
}

function validateAggregateBinding(
  loaded: readonly LoadedRun[],
  jobId: string,
  resumeProfileId: string | null | undefined,
): void {
  for (const item of loaded) {
    if (item.run.jobId !== jobId) {
      throw new TailoringRunError(
        "JOB_MISMATCH",
        "Tailoring run belongs to a different Job",
      );
    }
    if (
      resumeProfileId !== undefined &&
      item.run.resumeProfileId !== resumeProfileId
    ) {
      throw new TailoringRunError(
        "PROFILE_MISMATCH",
        "Tailoring run belongs to a different Resume Profile",
      );
    }
  }
}

function partitionRequests(
  loaded: readonly LoadedRun[],
  receipts: ReadonlyMap<string, TailoringReceiptRow>,
): {
  pending: TailoringAcceptanceRequest[];
  replayed: TailoringAcceptanceReceipt[];
  runs: PreparedTailoringRun[];
} {
  const pending: TailoringAcceptanceRequest[] = [];
  const replayed: TailoringAcceptanceReceipt[] = [];
  const runs: PreparedTailoringRun[] = [];
  for (const item of loaded) {
    let hasPending = false;
    for (const request of item.requests) {
      const replay = checkReceiptReplay(request, receipts);
      if (replay) {
        replayed.push(replay);
        continue;
      }
      validatePendingRequest(item.run, request);
      pending.push(request);
      hasPending = true;
    }
    if (hasPending) runs.push(preparedRunOf(item.run));
  }
  return { pending, replayed, runs };
}

/**
 * Transaction helper used before the Application upsert. It acquires every
 * TJOB lock first, then every ABAT lock and every TLRN lock in run-id order.
 * Exact receipt replay is resolved before attempt fencing.
 */
export async function prepareTailoringRunAcceptance(
  tx: TailoringRunTransaction,
  input: {
    userId: string;
    jobId: string;
    resumeProfileId?: string | null;
    requests: readonly TailoringAcceptanceRequest[];
  },
): Promise<PreparedTailoringAcceptance> {
  if (input.requests.length === 0) {
    throw new TailoringRunError(
      "TARGET_NOT_REQUIRED",
      "At least one acceptance target is required",
    );
  }
  validateUniqueRequests(input.requests);
  await acquireTailoringJobLock(
    tx as unknown as Prisma.TransactionClient,
    input.userId,
    input.jobId,
  );
  const stale = await loadRuns(tx, input.userId, input.requests);
  await acquireAcceptanceLocks(tx, stale);
  const loaded = await reloadRuns(tx, input.userId, stale);
  validateAggregateBinding(loaded, input.jobId, input.resumeProfileId);
  const receipts = await readExistingReceipts(tx, input.requests);
  return {
    userId: input.userId,
    ...partitionRequests(loaded, receipts),
  };
}

function requestsForRun(
  prepared: PreparedTailoringAcceptance,
  runId: string,
): TailoringAcceptanceRequest[] {
  return prepared.pending.filter((request) => request.handle.id === runId);
}

async function insertRunReceipts(
  tx: TailoringRunTransaction,
  run: PreparedTailoringRun,
  requests: readonly TailoringAcceptanceRequest[],
  applicationId: string,
  aiContentHash: string,
  documentContentHashes: CompleteTailoringAcceptanceInput["documentContentHashes"],
): Promise<TailoringAcceptanceReceipt[]> {
  const receipts: TailoringAcceptanceReceipt[] = [];
  for (const request of requests) {
    const documentContentHash = documentContentHashes[request.target];
    if (!documentContentHash) {
      throw new TailoringRunError(
        "RECEIPT_CONFLICT",
        `Missing ${request.target} documentContentHash`,
      );
    }
    const created = await tx.tailoringRunReceipt.create({
      data: {
        runId: run.id,
        target: request.target,
        executionAttemptId: run.executionAttemptId,
        requestHash: request.requestHash,
        applicationId,
        aiContentHash,
        documentContentHash,
        delivery: run.delivery,
      },
    });
    receipts.push(receiptOf(created));
  }
  return receipts;
}

function acceptedMask(
  run: PreparedTailoringRun,
  requests: readonly TailoringAcceptanceRequest[],
): number {
  return requests.reduce(
    (mask, request) => mask | targetMask(request.target),
    run.acceptedTargetMask,
  );
}

async function finishRunProjection(
  tx: TailoringRunTransaction,
  run: PreparedTailoringRun,
  requests: readonly TailoringAcceptanceRequest[],
  applicationId: string,
): Promise<boolean> {
  const mask = acceptedMask(run, requests);
  const accepted = (mask & run.requiredTargetMask) === run.requiredTargetMask;
  const published =
    (run.publishedTargetMask & run.publicationRequiredTargetMask) ===
    run.publicationRequiredTargetMask;
  const completed = accepted && published;
  await tx.tailoringRun.update({
    where: { id: run.id },
    data: {
      acceptedTargetMask: mask,
      applicationId,
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
  if (completed && run.batchTask?.executionAttemptId) {
    await completeBoundBatchTask(
      tx,
      run.batchTask,
      run.batchTask.executionAttemptId,
      "SUCCEEDED",
      null,
    );
  }
  return completed;
}

/**
 * Call after the Application upsert, in the same transaction and while the
 * locks acquired by prepareTailoringRunAcceptance are still held.
 */
export async function completeTailoringRunAcceptance(
  tx: TailoringRunTransaction,
  input: CompleteTailoringAcceptanceInput,
): Promise<CompletedTailoringAcceptance> {
  validateAcceptanceHash(input.aiContentHash, "aiContentHash");
  for (const request of input.prepared.pending) {
    const documentContentHash = input.documentContentHashes[request.target];
    if (!documentContentHash) {
      throw new TailoringRunError(
        "RECEIPT_CONFLICT",
        `Missing ${request.target} documentContentHash`,
      );
    }
    validateAcceptanceHash(documentContentHash, "documentContentHash");
  }
  const created: TailoringAcceptanceReceipt[] = [];
  const completedRunIds: string[] = [];
  for (const run of input.prepared.runs) {
    const requests = requestsForRun(input.prepared, run.id);
    created.push(
      ...(await insertRunReceipts(
        tx,
        run,
        requests,
        input.applicationId,
        input.aiContentHash,
        input.documentContentHashes,
      )),
    );
    if (await finishRunProjection(tx, run, requests, input.applicationId)) {
      completedRunIds.push(run.id);
    }
  }
  return {
    receipts: [...input.prepared.replayed, ...created],
    completedRunIds,
  };
}
