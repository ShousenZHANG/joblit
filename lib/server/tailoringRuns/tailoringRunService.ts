import type { Prisma } from "@/lib/generated/prisma";
import {
  acquireApplicationBatchLock,
  acquireTailoringJobLock,
  acquireTailoringRunLock,
} from "./tailoringRunLock";
import {
  assertNoActiveTailoringRun,
  retireStaleStandaloneTailoringRuns,
} from "./tailoringJobOwnership";
import {
  TailoringRunError,
  requiredTargetMask,
  targetMask,
} from "./tailoringRunProtocol";
import {
  tailoringRunDependencies,
  type TailoringRunDependencies,
  type TailoringRunRow,
  type TailoringRunTransaction,
} from "./tailoringRunDatabase";
import {
  assertBatchAttempt,
  assertRunMutable,
  issueHash,
  lockRun,
  normalizePromptReceipt,
  normalizePromptReceipts,
  readOwnedRun,
  readPromptReceipts,
  snapshotOf,
  validateHandle,
  validateSnapshotHash,
} from "./tailoringRunInternals";
import {
  assertSafeTailoringIdentity,
  tailoringRunIdForIssue,
  hashTailoringRunValue,
} from "./tailoringRunHash";
import { completeBoundBatchTask } from "./tailoringBatchProjection";
import { tailoringRunLeaseMs } from "./tailoringRunLease";
import { APPLICATION_BATCH_TAILORING_PROTOCOL_VERSION } from "../applicationBatches/tailoringTaskContract";
import type {
  BindTailoringRunPromptInput,
  CancelTailoringRunInput,
  FailTailoringRunInput,
  IssueTailoringRunInput,
  StartTailoringRunInput,
  StartTailoringRunResult,
  TailoringRunMutationResult,
  TailoringRunSnapshot,
} from "./tailoringRunTypes";

const TRANSACTION_OPTIONS = { timeout: 30_000 } as const;
const ISSUE_KEY_RE = /^[A-Za-z0-9:_-]{1,120}$/;

function validateIssueInput(input: IssueTailoringRunInput): {
  issueKey: string;
  targetMask: number;
} {
  const issueKey = input.issueKey.trim();
  const mask = requiredTargetMask(input.requiredTargets);
  let safeIssueKey = true;
  try {
    assertSafeTailoringIdentity(issueKey);
  } catch {
    safeIssueKey = false;
  }
  if (!ISSUE_KEY_RE.test(issueKey) || !safeIssueKey) {
    throw new TailoringRunError("ISSUE_KEY_CONFLICT", "Invalid issue key");
  }
  if (mask < 1 || mask > 3) {
    throw new TailoringRunError(
      "TARGET_NOT_REQUIRED",
      "At least one target is required",
    );
  }
  const batchSource =
    input.source === "CODEX_BATCH" || input.source === "SERVER_BATCH";
  if (batchSource !== Boolean(input.batch)) {
    throw new TailoringRunError(
      "INVALID_STATE",
      "Batch source and task binding must be supplied together",
    );
  }
  return { issueKey, targetMask: mask };
}

async function validateIssueOwnership(
  tx: TailoringRunTransaction,
  input: IssueTailoringRunInput,
): Promise<void> {
  const job = await tx.job.findFirst({
    where: { id: input.jobId, userId: input.userId },
    select: { id: true },
  });
  if (!job) throw new TailoringRunError("JOB_NOT_FOUND", "Job not found");
  if (!input.resumeProfileId) return;
  const profile = await tx.resumeProfile.findFirst({
    where: { id: input.resumeProfileId, userId: input.userId },
    select: { id: true },
  });
  if (!profile) {
    throw new TailoringRunError(
      "RESUME_PROFILE_NOT_FOUND",
      "Resume profile not found",
    );
  }
}

async function validateIssueBatch(
  tx: TailoringRunTransaction,
  input: IssueTailoringRunInput,
): Promise<void> {
  if (!input.batch) return;
  const task = await tx.applicationBatchTask.findFirst({
    where: {
      id: input.batch.taskId,
      batchId: input.batch.batchId,
      userId: input.userId,
      jobId: input.jobId,
    },
    select: {
      id: true,
      batchId: true,
      userId: true,
      jobId: true,
      status: true,
      executionAttemptId: true,
      tailoringProtocolVersion: true,
      completionAttemptId: true,
    },
  });
  if (!task) {
    throw new TailoringRunError(
      "BATCH_TASK_NOT_FOUND",
      "Application batch task not found",
    );
  }
  if (task.status !== "RUNNING") {
    throw new TailoringRunError(
      "BATCH_TASK_NOT_RUNNING",
      "Application batch task is not running",
    );
  }
  if (
    task.tailoringProtocolVersion !==
    APPLICATION_BATCH_TAILORING_PROTOCOL_VERSION
  ) {
    throw new TailoringRunError(
      "BATCH_PROTOCOL_MISMATCH",
      "Application batch task has not entered the TailoringRun protocol",
    );
  }
  if (task.executionAttemptId !== input.batch.executionAttemptId) {
    throw new TailoringRunError(
      "BATCH_ATTEMPT_MISMATCH",
      "The batch task attempt has been superseded",
    );
  }
}

async function validateExclusiveJobGeneration(
  tx: TailoringRunTransaction,
  input: IssueTailoringRunInput,
): Promise<void> {
  await assertNoActiveTailoringRun(
    tx as unknown as Prisma.TransactionClient,
    input,
  );

  if (!input.batch) return;
  const stillSafe = await tx.job.findFirst({
    where: {
      id: input.jobId,
      userId: input.userId,
      applications: { none: { userId: input.userId } },
    },
    select: { id: true },
  });
  if (!stillSafe) {
    throw new TailoringRunError(
      "INVALID_STATE",
      "An Application already exists for this Job",
    );
  }
}

function issueData(
  input: IssueTailoringRunInput,
  id: string,
  key: string,
  mask: number,
  hash: string,
  promptReceipts: ReturnType<typeof normalizePromptReceipts>,
) {
  return {
    id,
    userId: input.userId,
    jobId: input.jobId,
    resumeProfileId: input.resumeProfileId ?? null,
    applicationBatchTaskId: input.batch?.taskId ?? null,
    source: input.source,
    delivery: input.delivery,
    status: "ISSUED",
    requiredTargetMask: mask,
    acceptedTargetMask: 0,
    issueKey: key,
    issueHash: hash,
    promptReceipts,
    resumeSnapshotHash: validateSnapshotHash(
      input.resumeSnapshotHash,
      "resumeSnapshotHash",
    ),
    jobSnapshotHash: validateSnapshotHash(
      input.jobSnapshotHash,
      "jobSnapshotHash",
    ),
  };
}

async function applyIssue(
  tx: TailoringRunTransaction,
  input: IssueTailoringRunInput,
  runId: string,
  key: string,
  mask: number,
  now: Date,
): Promise<TailoringRunMutationResult> {
  await acquireTailoringJobLock(
    tx as unknown as Prisma.TransactionClient,
    input.userId,
    input.jobId,
  );
  if (input.batch) {
    await acquireApplicationBatchLock(
      tx as unknown as Prisma.TransactionClient,
      input.batch.batchId,
    );
  }
  const prompts = normalizePromptReceipts(input.promptReceipts);
  validateIssuedPromptTargets(prompts, mask);
  const hash = issueInputHash(input, mask, prompts);
  const existing = await tx.tailoringRun.findUnique({
    where: { userId_issueKey: { userId: input.userId, issueKey: key } },
    include: { applicationBatchTask: true },
  });
  if (existing) {
    await acquireTailoringRunLock(
      tx as unknown as Prisma.TransactionClient,
      runId,
    );
    const lockedExisting = await tx.tailoringRun.findUnique({
      where: { userId_issueKey: { userId: input.userId, issueKey: key } },
      include: { applicationBatchTask: true },
    });
    if (!lockedExisting) {
      throw new TailoringRunError("RUN_NOT_FOUND", "Tailoring run not found");
    }
    return replayIssue(tx, input, lockedExisting, hash);
  }
  await retireStaleStandaloneTailoringRuns(
    tx as unknown as Prisma.TransactionClient,
    { userId: input.userId, jobId: input.jobId, now },
  );
  await acquireTailoringRunLock(
    tx as unknown as Prisma.TransactionClient,
    runId,
  );
  await validateIssueOwnership(tx, input);
  await validateIssueBatch(tx, input);
  await validateExclusiveJobGeneration(tx, input);
  if (input.batch) {
    const taskRun = await tx.tailoringRun.findFirst({
      where: {
        applicationBatchTaskId: input.batch.taskId,
        userId: input.userId,
      },
      include: { applicationBatchTask: true },
    });
    if (taskRun) {
      throw new TailoringRunError(
        "ISSUE_KEY_CONFLICT",
        "Application batch task already belongs to another tailoring run",
      );
    }
  }
  const created = await tx.tailoringRun.create({
    data: issueData(input, runId, key, mask, hash, prompts),
  });
  return { disposition: "APPLIED", run: snapshotOf(created) };
}

function issueInputHash(
  input: IssueTailoringRunInput,
  mask: number,
  prompts: ReturnType<typeof normalizePromptReceipts>,
): string {
  return issueHash({
    userId: input.userId,
    jobId: input.jobId,
    resumeProfileId: input.resumeProfileId ?? null,
    source: input.source,
    delivery: input.delivery,
    requiredTargetMask: mask,
    resumeSnapshotHash: validateSnapshotHash(
      input.resumeSnapshotHash,
      "resumeSnapshotHash",
    ),
    jobSnapshotHash: validateSnapshotHash(
      input.jobSnapshotHash,
      "jobSnapshotHash",
    ),
    batchTaskId: input.batch?.taskId ?? null,
    promptReceipts: prompts,
  });
}

function validateIssuedPromptTargets(
  prompts: ReturnType<typeof normalizePromptReceipts>,
  mask: number,
): void {
  for (const target of Object.keys(prompts) as Array<"RESUME" | "COVER">) {
    if ((mask & targetMask(target)) !== 0) continue;
    throw new TailoringRunError(
      "TARGET_NOT_REQUIRED",
      "Prompt target is not required by this run",
    );
  }
}

async function replayIssue(
  tx: TailoringRunTransaction,
  input: IssueTailoringRunInput,
  existing: TailoringRunRow,
  hash: string,
): Promise<TailoringRunMutationResult> {
  if (existing.issueHash !== hash) {
    throw new TailoringRunError(
      "ISSUE_KEY_CONFLICT",
      "Issue key was already used for different inputs",
    );
  }
  await validateIssueBatch(tx, input);
  return { disposition: "REPLAYED", run: snapshotOf(existing) };
}

export async function issueTailoringRun(
  input: IssueTailoringRunInput,
  overrides?: Partial<TailoringRunDependencies>,
): Promise<TailoringRunMutationResult> {
  const deps = tailoringRunDependencies(overrides);
  const { issueKey, targetMask: mask } = validateIssueInput(input);
  const runId = tailoringRunIdForIssue(input.userId, issueKey);
  return deps.database.$transaction(
    (tx) => applyIssue(tx, input, runId, issueKey, mask, deps.now()),
    TRANSACTION_OPTIONS,
  );
}

function startAttemptId(
  input: StartTailoringRunInput,
  deps: TailoringRunDependencies,
): string {
  const attemptId = input.attemptId ?? deps.randomUuid();
  validateHandle(input.runId, attemptId);
  return attemptId;
}

function validateStartAuthority(
  run: TailoringRunRow,
  input: StartTailoringRunInput,
  attemptId: string,
  now: Date,
): boolean {
  assertRunMutable(run);
  const batchTask = assertBatchAttempt(run, input.batchExecutionAttemptId);
  if (batchTask && batchTask.executionAttemptId !== attemptId) {
    throw new TailoringRunError(
      "BATCH_ATTEMPT_MISMATCH",
      "Tailoring and batch attempts must use the same authority token",
    );
  }
  if (run.status !== "ISSUED" && run.status !== "RUNNING") {
    throw new TailoringRunError("INVALID_STATE", "Tailoring run cannot start");
  }
  const sameAttempt = run.executionAttemptId === attemptId;
  if (
    !batchTask &&
    run.executionAttemptId &&
    !sameAttempt &&
    run.executionLeaseExpiresAt &&
    run.executionLeaseExpiresAt > now
  ) {
    throw new TailoringRunError(
      "ATTEMPT_ACTIVE",
      "Another tailoring attempt still owns the lease",
    );
  }
  return sameAttempt;
}

async function applyStart(
  tx: TailoringRunTransaction,
  stale: TailoringRunRow,
  input: StartTailoringRunInput,
  attemptId: string,
  now: Date,
): Promise<StartTailoringRunResult> {
  const run = await lockRun(tx, stale);
  const sameAttempt = validateStartAuthority(run, input, attemptId, now);
  const leaseExpiresAt = new Date(
    now.getTime() + tailoringRunLeaseMs(run.source),
  );
  if (run.applicationBatchTask) {
    const renewed = await tx.applicationBatchTask.updateMany({
      where: {
        id: run.applicationBatchTask.id,
        batchId: run.applicationBatchTask.batchId,
        userId: run.userId,
        status: "RUNNING",
        executionAttemptId: attemptId,
      },
      data: {
        executionLeaseExpiresAt: leaseExpiresAt,
      },
    });
    if (renewed.count !== 1) {
      throw new TailoringRunError(
        "BATCH_ATTEMPT_MISMATCH",
        "The batch task lease could not be renewed",
      );
    }
  }
  const updated = await tx.tailoringRun.update({
    where: { id: run.id },
    data: {
      status: "RUNNING",
      executionAttemptId: attemptId,
      executionLeaseExpiresAt: leaseExpiresAt,
      attempt: sameAttempt ? run.attempt : { increment: 1 },
      startedAt: run.startedAt ?? now,
      errorCode: null,
      errorMessage: null,
      terminalAt: null,
    },
  });
  return {
    disposition: "APPLIED",
    handle: { id: run.id, attemptId },
    run: snapshotOf(updated),
  };
}

export async function startTailoringRun(
  input: StartTailoringRunInput,
  overrides?: Partial<TailoringRunDependencies>,
): Promise<StartTailoringRunResult> {
  const deps = tailoringRunDependencies(overrides);
  const attemptId = startAttemptId(input, deps);
  const stale = await readOwnedRun(deps.database, input.userId, input.runId);
  return deps.database.$transaction(
    (tx) => applyStart(tx, stale, input, attemptId, deps.now()),
    TRANSACTION_OPTIONS,
  );
}

async function applyPromptBinding(
  tx: TailoringRunTransaction,
  stale: TailoringRunRow,
  input: BindTailoringRunPromptInput,
): Promise<TailoringRunMutationResult> {
  const run = await lockRun(tx, stale);
  if ((run.requiredTargetMask & targetMask(input.target)) === 0) {
    throw new TailoringRunError(
      "TARGET_NOT_REQUIRED",
      "Prompt target is not required by this run",
    );
  }
  const next = normalizePromptReceipt(input.receipt);
  const receipts = readPromptReceipts(run.promptReceipts);
  const current = receipts[input.target];
  if (current) {
    if (hashTailoringRunValue(current) !== hashTailoringRunValue(next)) {
      throw new TailoringRunError(
        "PROMPT_CONFLICT",
        "The target prompt was already bound to different metadata",
      );
    }
    return { disposition: "REPLAYED", run: snapshotOf(run) };
  }
  assertRunMutable(run);
  assertBatchAttempt(run, input.batchExecutionAttemptId);
  const updated = await tx.tailoringRun.update({
    where: { id: run.id },
    data: { promptReceipts: { ...receipts, [input.target]: next } },
  });
  return { disposition: "APPLIED", run: snapshotOf(updated) };
}

export async function bindTailoringRunPrompt(
  input: BindTailoringRunPromptInput,
  overrides?: Partial<TailoringRunDependencies>,
): Promise<TailoringRunMutationResult> {
  const deps = tailoringRunDependencies(overrides);
  const stale = await readOwnedRun(deps.database, input.userId, input.runId);
  return deps.database.$transaction(
    (tx) => applyPromptBinding(tx, stale, input),
    TRANSACTION_OPTIONS,
  );
}

function safeFailure(input: FailTailoringRunInput): {
  code: string;
  message: string;
} {
  const code = /^[A-Z][A-Z0-9_]{0,79}$/.test(input.errorCode)
    ? input.errorCode
    : "TAILORING_FAILED";
  const message = (input.errorMessage?.trim() || "Tailoring failed")
    .replace(/run_[A-Za-z0-9_-]+/g, "[private executor id]")
    .slice(0, 500);
  return { code, message };
}

async function settleBoundTask(
  tx: TailoringRunTransaction,
  run: TailoringRunRow,
  status: "FAILED" | "SKIPPED",
  error: string,
): Promise<void> {
  const task = run.applicationBatchTask;
  if (!task?.executionAttemptId) return;
  await completeBoundBatchTask(
    tx,
    task,
    task.executionAttemptId,
    status,
    error,
  );
}

async function applyFailure(
  tx: TailoringRunTransaction,
  stale: TailoringRunRow,
  input: FailTailoringRunInput,
  now: Date,
): Promise<TailoringRunMutationResult> {
  const run = await lockRun(tx, stale);
  if (["SUCCEEDED", "FAILED", "CANCELLED", "PARTIAL"].includes(run.status)) {
    return { disposition: "REPLAYED", run: snapshotOf(run) };
  }
  assertBatchAttempt(run, input.batchExecutionAttemptId);
  if (run.status !== "RUNNING") {
    throw new TailoringRunError(
      "INVALID_STATE",
      "Tailoring run is not running",
    );
  }
  if (run.executionAttemptId !== input.handle.attemptId) {
    throw new TailoringRunError(
      "ATTEMPT_STALE",
      "The tailoring attempt has been superseded",
    );
  }
  const failure = safeFailure(input);
  const status = run.acceptedTargetMask > 0 ? "PARTIAL" : "FAILED";
  const updated = await tx.tailoringRun.update({
    where: { id: run.id },
    data: {
      status,
      errorCode: failure.code,
      errorMessage: failure.message,
      terminalAt: now,
      executionLeaseExpiresAt: null,
    },
  });
  await settleBoundTask(tx, run, "FAILED", failure.message);
  return { disposition: "APPLIED", run: snapshotOf(updated) };
}

export async function failTailoringRun(
  input: FailTailoringRunInput,
  overrides?: Partial<TailoringRunDependencies>,
): Promise<TailoringRunMutationResult> {
  validateHandle(input.handle.id, input.handle.attemptId);
  const deps = tailoringRunDependencies(overrides);
  const stale = await readOwnedRun(
    deps.database,
    input.userId,
    input.handle.id,
  );
  return deps.database.$transaction(
    (tx) => applyFailure(tx, stale, input, deps.now()),
    TRANSACTION_OPTIONS,
  );
}

async function applyCancellation(
  tx: TailoringRunTransaction,
  stale: TailoringRunRow,
  input: CancelTailoringRunInput,
  now: Date,
): Promise<TailoringRunMutationResult> {
  const run = await lockRun(tx, stale);
  if (["SUCCEEDED", "FAILED", "CANCELLED", "PARTIAL"].includes(run.status)) {
    return { disposition: "REPLAYED", run: snapshotOf(run) };
  }
  if (
    run.applicationBatchTask &&
    run.applicationBatchTask.executionAttemptId !== input.handle.attemptId
  ) {
    throw new TailoringRunError(
      "ATTEMPT_STALE",
      "The batch task attempt has been superseded",
    );
  }
  if (run.executionAttemptId !== input.handle.attemptId) {
    throw new TailoringRunError(
      "ATTEMPT_STALE",
      "The tailoring attempt has been superseded",
    );
  }
  const status = run.acceptedTargetMask > 0 ? "PARTIAL" : "CANCELLED";
  const updated = await tx.tailoringRun.update({
    where: { id: run.id },
    data: {
      status,
      errorCode: "TAILORING_CANCELLED",
      errorMessage: "Cancelled by user",
      terminalAt: now,
      executionLeaseExpiresAt: null,
    },
  });
  await settleBoundTask(tx, run, "SKIPPED", "Cancelled by user");
  return { disposition: "APPLIED", run: snapshotOf(updated) };
}

export async function cancelTailoringRun(
  input: CancelTailoringRunInput,
  overrides?: Partial<TailoringRunDependencies>,
): Promise<TailoringRunMutationResult> {
  validateHandle(input.handle.id, input.handle.attemptId);
  const deps = tailoringRunDependencies(overrides);
  const stale = await readOwnedRun(
    deps.database,
    input.userId,
    input.handle.id,
  );
  return deps.database.$transaction(
    (tx) => applyCancellation(tx, stale, input, deps.now()),
    TRANSACTION_OPTIONS,
  );
}

export async function getTailoringRunStatus(
  userId: string,
  runId: string,
  overrides?: Partial<TailoringRunDependencies>,
): Promise<TailoringRunSnapshot> {
  const deps = tailoringRunDependencies(overrides);
  return snapshotOf(await readOwnedRun(deps.database, userId, runId));
}
