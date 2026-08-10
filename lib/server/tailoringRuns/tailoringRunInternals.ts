import { TailoringRunHandleSchema } from "@/lib/shared/tailoringRunContract";
import type { Prisma } from "@/lib/generated/prisma";
import {
  acquireApplicationBatchLock,
  acquireTailoringRunLock,
} from "./tailoringRunLock";
import {
  TailoringRunError,
  isTailoringRunTerminal,
  type TailoringRunTarget,
} from "./tailoringRunProtocol";
import type {
  TailoringBatchTaskRow,
  TailoringRunDatabase,
  TailoringRunRow,
  TailoringRunTransaction,
} from "./tailoringRunDatabase";
import type {
  TailoringPromptReceipt,
  TailoringPromptReceipts,
  TailoringRunSnapshot,
} from "./tailoringRunTypes";
import {
  assertSafeTailoringIdentity,
  hashTailoringRunValue,
} from "./tailoringRunHash";
import {
  APPLICATION_BATCH_TAILORING_PROTOCOL_VERSION,
  LEGACY_APPLICATION_BATCH_TAILORING_PROTOCOL_VERSION,
} from "../applicationBatches/tailoringTaskContract";

const HASH_MAX_LENGTH = 256;
const RECEIPT_STRING_MAX_LENGTH = 256;

function safeIdentity(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new TailoringRunError(
      "INVALID_PROMPT_RECEIPT",
      `Invalid ${field}`,
    );
  }
  const cleaned = value.trim();
  try {
    assertSafeTailoringIdentity(cleaned);
  } catch {
    throw new TailoringRunError(
      "INVALID_PROMPT_RECEIPT",
      `Invalid ${field}`,
    );
  }
  if (!cleaned || cleaned.length > RECEIPT_STRING_MAX_LENGTH) {
    throw new TailoringRunError(
      "INVALID_PROMPT_RECEIPT",
      `Invalid ${field}`,
    );
  }
  return cleaned;
}

export function normalizePromptReceipt(
  value: TailoringPromptReceipt,
): TailoringPromptReceipt {
  const receipt: TailoringPromptReceipt = {
    promptHash: safeIdentity(value.promptHash, "promptHash"),
  };
  for (const key of [
    "promptMetaHash",
    "ruleSetId",
    "promptTemplateVersion",
    "schemaVersion",
    "skillPackVersion",
  ] as const) {
    const item = value[key];
    if (item !== undefined) receipt[key] = safeIdentity(item, key);
  }
  return receipt;
}

export function normalizePromptReceipts(
  value: TailoringPromptReceipts | undefined,
): TailoringPromptReceipts {
  const result: TailoringPromptReceipts = {};
  for (const target of ["RESUME", "COVER"] as const) {
    const receipt = value?.[target];
    if (receipt) result[target] = normalizePromptReceipt(receipt);
  }
  return result;
}

export function readPromptReceipts(value: unknown): TailoringPromptReceipts {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const receipts: TailoringPromptReceipts = {};
  for (const target of ["RESUME", "COVER"] as const) {
    const item = record[target];
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    receipts[target] = normalizePromptReceipt(
      item as TailoringPromptReceipt,
    );
  }
  return receipts;
}

export function issueHash(input: {
  userId: string;
  jobId: string;
  resumeProfileId?: string | null;
  source: string;
  delivery: string;
  requiredTargetMask: number;
  publicationRequiredTargetMask: number;
  resumeSnapshotHash: string;
  jobSnapshotHash: string;
  batchTaskId?: string | null;
  promptReceipts: TailoringPromptReceipts;
}): string {
  return hashTailoringRunValue({
    protocol: "tailoring-run/v1",
    ...input,
  });
}

export function validateSnapshotHash(value: string, field: string): string {
  const cleaned = value.trim();
  try {
    assertSafeTailoringIdentity(cleaned);
  } catch {
    throw new TailoringRunError("SNAPSHOT_MISMATCH", `Invalid ${field}`);
  }
  if (!cleaned || cleaned.length > HASH_MAX_LENGTH) {
    throw new TailoringRunError("SNAPSHOT_MISMATCH", `Invalid ${field}`);
  }
  return cleaned;
}

export function validateHandle(runId: string, attemptId: string): void {
  const parsed = TailoringRunHandleSchema.safeParse({
    id: runId,
    attemptId,
  });
  if (!parsed.success) {
    throw new TailoringRunError(
      "INVALID_ATTEMPT_ID",
      "Tailoring run handle is invalid",
    );
  }
}

export function snapshotOf(run: TailoringRunRow): TailoringRunSnapshot {
  const handle =
    run.executionAttemptId == null
      ? null
      : { id: run.id, attemptId: run.executionAttemptId };
  return {
    id: run.id,
    status: run.status,
    source: run.source,
    delivery: run.delivery,
    requiredTargetMask: run.requiredTargetMask,
    acceptedTargetMask: run.acceptedTargetMask,
    publicationRequiredTargetMask: run.publicationRequiredTargetMask,
    publishedTargetMask: run.publishedTargetMask,
    applicationId: run.applicationId,
    applicationBatchTaskId: run.applicationBatchTaskId,
    handle,
    attempt: run.attempt,
    leaseExpiresAt: run.executionLeaseExpiresAt,
    errorCode: run.errorCode,
    errorMessage: run.errorMessage,
    terminalAt: run.terminalAt,
  };
}

export async function readOwnedRun(
  database: TailoringRunDatabase | TailoringRunTransaction,
  userId: string,
  runId: string,
): Promise<TailoringRunRow> {
  const run = await database.tailoringRun.findFirst({
    where: { id: runId, userId },
    include: { applicationBatchTask: true },
  });
  if (!run) {
    throw new TailoringRunError("RUN_NOT_FOUND", "Tailoring run not found");
  }
  return run;
}

export async function lockRun(
  tx: TailoringRunTransaction,
  run: TailoringRunRow,
): Promise<TailoringRunRow> {
  if (run.applicationBatchTask?.batchId) {
    await acquireApplicationBatchLock(
      tx as unknown as Prisma.TransactionClient,
      run.applicationBatchTask.batchId,
    );
  }
  await acquireTailoringRunLock(
    tx as unknown as Prisma.TransactionClient,
    run.id,
  );
  return readOwnedRun(tx, run.userId, run.id);
}

export function assertBatchAttempt(
  run: TailoringRunRow,
  received: string | undefined,
): TailoringBatchTaskRow | null {
  const task = run.applicationBatchTask ?? null;
  if (!task) return null;
  const expectedProtocolVersion =
    run.delivery === "DRAFT"
      ? APPLICATION_BATCH_TAILORING_PROTOCOL_VERSION
      : LEGACY_APPLICATION_BATCH_TAILORING_PROTOCOL_VERSION;
  if (task.tailoringProtocolVersion !== expectedProtocolVersion) {
    throw new TailoringRunError(
      "BATCH_PROTOCOL_MISMATCH",
      "The batch task has not claimed the TailoringRun protocol",
    );
  }
  if (!task.executionAttemptId || task.executionAttemptId !== received) {
    throw new TailoringRunError(
      "BATCH_ATTEMPT_MISMATCH",
      "The batch task attempt has been superseded",
    );
  }
  if (task.status !== "RUNNING") {
    throw new TailoringRunError(
      "BATCH_TASK_NOT_RUNNING",
      "The batch task is not running",
    );
  }
  return task;
}

export function assertRunMutable(run: TailoringRunRow): void {
  if (isTailoringRunTerminal(run.status)) {
    throw new TailoringRunError(
      "RUN_ALREADY_TERMINAL",
      "The tailoring run is already terminal",
    );
  }
}

export function promptForTarget(
  run: TailoringRunRow,
  target: TailoringRunTarget,
): TailoringPromptReceipt {
  const receipt = readPromptReceipts(run.promptReceipts)[target];
  if (!receipt) {
    throw new TailoringRunError(
      "PROMPT_NOT_BOUND",
      "The target prompt has not been bound",
    );
  }
  return receipt;
}
