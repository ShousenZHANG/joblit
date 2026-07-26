import type { FetchRunStatus, Prisma } from "@/lib/generated/prisma";
import { prisma } from "@/lib/server/prisma";
import { acquireFetchRunLifecycleLock } from "./fetchRunLifecycleLock";
import { hashFetchRunBatch } from "./fetchRunBatchHash";
import {
  isJobImportEnrichmentMigrationRace,
  persistPreparedJobImport,
  prepareJobImportForUser,
  type PreparedJobImport,
} from "@/lib/server/jobs/jobImportService";
import { reportError } from "@/lib/server/observability/errorReporter";
import {
  AU_FETCH_RUN_EXECUTION_LEASE_MS,
  FETCH_RUN_COMMIT_PROTOCOL,
  INLINE_FETCH_RUN_EXECUTION_LEASE_MS,
} from "@/lib/shared/fetchRunProtocol";
import type {
  FetchRunCommitBatchCommand,
  FetchRunCommitFailCommand,
  FetchRunCommitStartCommand,
} from "@/lib/shared/schemas/fetchRunCommit";

export { FETCH_RUN_COMMIT_PROTOCOL } from "@/lib/shared/fetchRunProtocol";
export const FETCH_RUN_CANCELLED_ERROR = "Cancelled by user";

const COMMIT_TRANSACTION_TIMEOUT_MS = 30_000;
const TERMINAL_STATUSES: readonly FetchRunStatus[] = [
  "SUCCEEDED",
  "FAILED",
  "PARTIAL",
];

type RunBound<T> = T & { runId: string };
type FetchRunExternalFailCommand = RunBound<FetchRunCommitFailCommand> & {
  staleBefore?: never;
};
type FetchRunInternalStaleFailCommand = {
  protocol: typeof FETCH_RUN_COMMIT_PROTOCOL;
  command: "fail";
  runId: string;
  error: string;
  // Internal stale recovery guard. HTTP adapters cannot set this field.
  staleBefore: Date;
  attemptId?: never;
};
export type FetchRunCommitCommand =
  | RunBound<FetchRunCommitStartCommand>
  | RunBound<FetchRunCommitBatchCommand>
  | FetchRunExternalFailCommand
  | FetchRunInternalStaleFailCommand;

type BatchCommand = Extract<FetchRunCommitCommand, { command: "commit" }>;
type FailCommand = Extract<FetchRunCommitCommand, { command: "fail" }>;
type Transaction = Prisma.TransactionClient;
interface RunProjectionRecord {
  status: FetchRunStatus;
  error: string | null;
  importedCount: number;
  executionAttemptId: string | null;
}
interface StartRunRecord extends RunProjectionRecord {
  market: string;
  executionLeaseExpiresAt: Date | null;
}
interface FailRunRecord extends RunProjectionRecord {
  commitStartedAt: Date | null;
  nextBatchIndex: number;
  updatedAt: Date;
}
interface BatchRunRecord extends RunProjectionRecord {
  userId: string;
  market: string;
  expectedBatchCount: number | null;
  nextBatchIndex: number;
  commitStartedAt: Date | null;
}
interface BatchReceiptRecord {
  requestHash: string;
  executionAttemptId: string;
  importedCount: number;
  invalidCount: number;
}
const RUN_PROJECTION_SELECT = {
  status: true,
  error: true,
  importedCount: true,
  executionAttemptId: true,
} as const;

export interface FetchRunCommitResult {
  disposition: "APPLIED" | "REPLAYED";
  /**
   * Canonical attempt that owns the applied result. On receipt replay this is
   * the receipt writer, which may differ from the caller after a takeover.
   * Optional keeps the v1 response additive for existing TypeScript consumers.
   */
  executionAttemptId?: string | null;
  batchImported: number;
  batchInvalid: number;
  totalImported: number;
  status: FetchRunStatus;
}

export type FetchRunCommitErrorCode =
  | "RUN_NOT_FOUND"
  | "RUN_CANCELLED"
  | "RUN_ALREADY_TERMINAL"
  | "RUN_NOT_RUNNING"
  | "EXECUTION_LEASE_HELD"
  | "EXECUTION_LEASE_LOST"
  | "BATCH_CONTENT_CONFLICT"
  | "BATCH_STREAM_CONFLICT"
  | "BATCH_OUT_OF_ORDER"
  | "INVALID_TERMINAL_BATCH";

export class FetchRunCommitError extends Error {
  constructor(
    readonly code: FetchRunCommitErrorCode,
    message: string,
    readonly status = 409,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "FetchRunCommitError";
  }
}

const EXECUTION_SUPERSEDED_CODES: readonly FetchRunCommitErrorCode[] = [
  "RUN_ALREADY_TERMINAL",
  "EXECUTION_LEASE_HELD",
  "EXECUTION_LEASE_LOST",
];

export type FetchRunExecutionStopReason = "cancelled" | "superseded";

/** Classify a non-failure stop without conflating takeover with user intent. */
export function fetchRunExecutionStopReason(
  error: unknown,
): FetchRunExecutionStopReason | null {
  if (!(error instanceof FetchRunCommitError)) return null;
  if (error.code === "RUN_CANCELLED") return "cancelled";
  return EXECUTION_SUPERSEDED_CODES.includes(error.code)
    ? "superseded"
    : null;
}

function isTerminal(status: FetchRunStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}
function resultFor(
  disposition: FetchRunCommitResult["disposition"],
  status: FetchRunStatus,
  totalImported: number,
  batchImported = 0,
  batchInvalid = 0,
  executionAttemptId?: string | null,
): FetchRunCommitResult {
  return {
    disposition,
    ...(executionAttemptId !== undefined ? { executionAttemptId } : {}),
    batchImported,
    batchInvalid,
    totalImported,
    status,
  };
}
function lifecycleResult(
  disposition: FetchRunCommitResult["disposition"],
  status: FetchRunStatus,
  totalImported: number,
  executionAttemptId: string | null,
): FetchRunCommitResult {
  return resultFor(disposition, status, totalImported, 0, 0, executionAttemptId);
}
function commitTransaction<T>(
  action: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(action, { timeout: COMMIT_TRANSACTION_TIMEOUT_MS });
}
function executionLeaseExpiresAt(market: string, now: Date): Date {
  const leaseMs =
    market === "AU"
      ? AU_FETCH_RUN_EXECUTION_LEASE_MS
      : INLINE_FETCH_RUN_EXECUTION_LEASE_MS;
  return new Date(now.getTime() + leaseMs);
}
function assertExecutionAttempt(
  currentAttemptId: string | null,
  receivedAttemptId: string,
): void {
  if (currentAttemptId !== receivedAttemptId) {
    throw new FetchRunCommitError(
      "EXECUTION_LEASE_LOST",
      "This executor no longer owns the fetch run",
    );
  }
}
function runNotFound(): never {
  throw new FetchRunCommitError("RUN_NOT_FOUND", "Fetch run not found", 404);
}
function assertRunNotCancelled(
  status: FetchRunStatus,
  error: string | null,
): void {
  if (
    (status === "FAILED" || status === "PARTIAL") &&
    error === FETCH_RUN_CANCELLED_ERROR
  ) {
    throw new FetchRunCommitError("RUN_CANCELLED", "Fetch run was cancelled");
  }
}
function assertRunNotTerminal(status: FetchRunStatus): void {
  if (!isTerminal(status)) return;
  throw new FetchRunCommitError(
    "RUN_ALREADY_TERMINAL",
    "Fetch run is already terminal",
    409,
    { status },
  );
}

async function loadStartRun(
  tx: Transaction,
  runId: string,
): Promise<StartRunRecord> {
  const run = await tx.fetchRun.findUnique({
    where: { id: runId },
    select: {
      ...RUN_PROJECTION_SELECT,
      market: true,
      executionLeaseExpiresAt: true,
    },
  });
  return run ?? runNotFound();
}
async function renewStartAttempt(
  tx: Transaction,
  runId: string,
  run: StartRunRecord,
  attemptId: string,
  leaseExpiresAt: Date,
): Promise<FetchRunCommitResult> {
  await tx.fetchRun.update({
    where: { id: runId },
    data: { executionLeaseExpiresAt: leaseExpiresAt },
  });
  return lifecycleResult("REPLAYED", run.status, run.importedCount, attemptId);
}
function assertStartLeaseAvailable(run: StartRunRecord, now: Date): void {
  if (
    run.executionAttemptId &&
    run.executionLeaseExpiresAt &&
    run.executionLeaseExpiresAt > now
  ) {
    throw new FetchRunCommitError(
      "EXECUTION_LEASE_HELD",
      "Another executor currently owns the fetch run",
    );
  }
}
async function claimRunningAttempt(
  tx: Transaction,
  runId: string,
  run: StartRunRecord,
  attemptId: string,
  leaseExpiresAt: Date,
): Promise<FetchRunCommitResult> {
  await tx.fetchRun.update({
    where: { id: runId },
    data: {
      executionAttemptId: attemptId,
      executionLeaseExpiresAt: leaseExpiresAt,
      error: null,
    },
  });
  return lifecycleResult("APPLIED", run.status, run.importedCount, attemptId);
}
async function activateQueuedRun(
  tx: Transaction,
  runId: string,
  run: StartRunRecord,
  attemptId: string,
  leaseExpiresAt: Date,
): Promise<FetchRunCommitResult> {
  await tx.fetchRun.update({
    where: { id: runId },
    data: {
      status: "RUNNING",
      error: null,
      executionAttemptId: attemptId,
      executionLeaseExpiresAt: leaseExpiresAt,
    },
  });
  return lifecycleResult("APPLIED", "RUNNING", run.importedCount, attemptId);
}
async function applyStart(
  tx: Transaction,
  runId: string,
  attemptId: string,
): Promise<FetchRunCommitResult> {
  await acquireFetchRunLifecycleLock(tx, runId);
  const run = await loadStartRun(tx, runId);
  assertRunNotCancelled(run.status, run.error);
  const now = new Date();
  const leaseExpiresAt = executionLeaseExpiresAt(run.market, now);
  if (run.status !== "RUNNING") {
    assertRunNotTerminal(run.status);
    return activateQueuedRun(tx, runId, run, attemptId, leaseExpiresAt);
  }
  if (run.executionAttemptId === attemptId) {
    return renewStartAttempt(tx, runId, run, attemptId, leaseExpiresAt);
  }
  assertStartLeaseAvailable(run, now);
  return claimRunningAttempt(tx, runId, run, attemptId, leaseExpiresAt);
}

async function startFetchRun(
  runId: string,
  attemptId: string,
): Promise<FetchRunCommitResult> {
  return commitTransaction((tx) => applyStart(tx, runId, attemptId));
}

async function loadFailRun(
  tx: Transaction,
  runId: string,
): Promise<FailRunRecord> {
  const run = await tx.fetchRun.findUnique({
    where: { id: runId },
    select: {
      ...RUN_PROJECTION_SELECT,
      commitStartedAt: true,
      nextBatchIndex: true,
      updatedAt: true,
    },
  });
  return run ?? runNotFound();
}

function replayRun(run: FailRunRecord): FetchRunCommitResult {
  return lifecycleResult(
    "REPLAYED",
    run.status,
    run.importedCount,
    run.executionAttemptId,
  );
}

function failedRunStatus(run: FailRunRecord): FetchRunStatus {
  return run.commitStartedAt || run.nextBatchIndex > 0 ? "PARTIAL" : "FAILED";
}

async function persistRunFailure(
  tx: Transaction,
  command: FailCommand,
  run: FailRunRecord,
): Promise<FetchRunCommitResult> {
  const status = failedRunStatus(run);
  await tx.fetchRun.update({
    where: { id: command.runId },
    data: {
      status,
      error: command.error.slice(0, 2_000),
      terminalAt: new Date(),
    },
  });
  return lifecycleResult("APPLIED", status, run.importedCount, run.executionAttemptId);
}

async function applyFailure(
  tx: Transaction,
  command: FailCommand,
): Promise<FetchRunCommitResult> {
  await acquireFetchRunLifecycleLock(tx, command.runId);
  const run = await loadFailRun(tx, command.runId);
  assertRunNotCancelled(run.status, run.error);
  if (!command.staleBefore) {
    // External executors remain fenced even when the run is terminal.
    assertExecutionAttempt(run.executionAttemptId, command.attemptId ?? "");
  }
  if (isTerminal(run.status)) return replayRun(run);
  // Progress after the unlocked stale snapshot wins cleanup.
  if (command.staleBefore && run.updatedAt >= command.staleBefore) {
    return replayRun(run);
  }
  return persistRunFailure(tx, command, run);
}

async function failFetchRun(
  command: FailCommand,
): Promise<FetchRunCommitResult> {
  return commitTransaction((tx) => applyFailure(tx, command));
}

interface ApplyBatchInput {
  command: BatchCommand;
  prepared: PreparedJobImport;
  requestHash: string;
  includeEnrichment: boolean;
}

async function loadBatchRun(
  tx: Transaction,
  runId: string,
): Promise<BatchRunRecord> {
  const run = await tx.fetchRun.findUnique({
    where: { id: runId },
    select: {
      ...RUN_PROJECTION_SELECT,
      userId: true,
      market: true,
      expectedBatchCount: true,
      nextBatchIndex: true,
      commitStartedAt: true,
    },
  });
  return run ?? runNotFound();
}

async function loadBatchReceipt(
  tx: Transaction,
  command: BatchCommand,
): Promise<BatchReceiptRecord | null> {
  return tx.fetchRunCommitReceipt.findUnique({
    where: {
      fetchRunId_batchKey: {
        fetchRunId: command.runId,
        batchKey: command.batchKey,
      },
    },
    select: {
      requestHash: true,
      executionAttemptId: true,
      importedCount: true,
      invalidCount: true,
    },
  });
}

function replayBatchReceipt(
  run: BatchRunRecord,
  prior: BatchReceiptRecord | null,
  input: ApplyBatchInput,
): FetchRunCommitResult | null {
  if (!prior) return null;
  if (prior.requestHash !== input.requestHash) {
    // Stale writers observe authority loss; only the current owner receives
    // the deterministic-content diagnosis for an existing durable key.
    assertExecutionAttempt(
      run.executionAttemptId,
      input.command.attemptId,
    );
    throw new FetchRunCommitError(
      "BATCH_CONTENT_CONFLICT",
      "Batch key was already used for different content",
      409,
      { batchKey: input.command.batchKey },
    );
  }
  return resultFor(
    "REPLAYED",
    run.status,
    run.importedCount,
    prior.importedCount,
    prior.invalidCount,
    prior.executionAttemptId,
  );
}

function validateActiveBatchRun(
  run: BatchRunRecord,
  command: BatchCommand,
): void {
  assertRunNotCancelled(run.status, run.error);
  assertRunNotTerminal(run.status);
  if (run.status !== "RUNNING") {
    throw new FetchRunCommitError(
      "RUN_NOT_RUNNING",
      "Fetch run must be started before committing",
      409,
      { status: run.status },
    );
  }
  assertExecutionAttempt(run.executionAttemptId, command.attemptId);
}

function validateTerminalBatch(command: BatchCommand): void {
  if (command.batchCount <= 0 || command.batchIndex < 0) {
    throw new FetchRunCommitError(
      "BATCH_STREAM_CONFLICT",
      "Batch index and count are invalid",
    );
  }
  const isFinalIndex = command.batchIndex === command.batchCount - 1;
  if (
    command.batchIndex >= command.batchCount ||
    command.terminal !== isFinalIndex
  ) {
    throw new FetchRunCommitError(
      "INVALID_TERMINAL_BATCH",
      "Only the final declared batch may be terminal",
      409,
      {
        batchIndex: command.batchIndex,
        batchCount: command.batchCount,
        terminal: command.terminal,
      },
    );
  }
  if (command.terminal && command.discoveredCount === undefined) {
    throw new FetchRunCommitError(
      "INVALID_TERMINAL_BATCH",
      "The terminal batch must include the total discovered count",
      409,
      { batchIndex: command.batchIndex },
    );
  }
}

function validateBatchProgress(
  run: BatchRunRecord,
  command: BatchCommand,
): void {
  if (
    run.expectedBatchCount !== null &&
    run.expectedBatchCount !== command.batchCount
  ) {
    throw new FetchRunCommitError(
      "BATCH_STREAM_CONFLICT",
      "Batch count changed during execution",
      409,
      {
        expected: run.expectedBatchCount,
        received: command.batchCount,
      },
    );
  }
  if (run.nextBatchIndex !== command.batchIndex) {
    throw new FetchRunCommitError(
      "BATCH_OUT_OF_ORDER",
      "Batch arrived out of order",
      409,
      { expected: run.nextBatchIndex, received: command.batchIndex },
    );
  }
}

async function persistBatchReceipt(
  tx: Transaction,
  input: ApplyBatchInput,
  imported: number,
): Promise<void> {
  const { command, prepared, requestHash } = input;
  await tx.fetchRunCommitReceipt.create({
    data: {
      fetchRunId: command.runId,
      batchKey: command.batchKey,
      executionAttemptId: command.attemptId,
      batchIndex: command.batchIndex,
      batchCount: command.batchCount,
      requestHash,
      itemCount: command.items.length,
      importedCount: imported,
      invalidCount: prepared.invalid,
      terminal: command.terminal,
    },
  });
}

function batchStatus(command: BatchCommand): FetchRunStatus {
  return command.terminal
    ? command.terminalOutcome ?? "SUCCEEDED"
    : "RUNNING";
}

function terminalProjection(
  command: BatchCommand,
  run: BatchRunRecord,
  status: FetchRunStatus,
) {
  if (!command.terminal) {
    return {
      executionLeaseExpiresAt: executionLeaseExpiresAt(run.market, new Date()),
    };
  }
  return {
    status,
    error:
      status === "PARTIAL"
        ? command.error?.slice(0, 2_000) || "PARTIAL_SOURCE_FAILURE"
        : null,
    terminalAt: new Date(),
    discoveredCount: Math.max(0, Math.trunc(command.discoveredCount ?? 0)),
  };
}

function batchProjectionData(
  input: ApplyBatchInput,
  run: BatchRunRecord,
  imported: number,
  status: FetchRunStatus,
) {
  return {
    importedCount: { increment: imported },
    invalidCount: { increment: input.prepared.invalid },
    expectedBatchCount: run.expectedBatchCount ?? input.command.batchCount,
    nextBatchIndex: input.command.batchIndex + 1,
    commitStartedAt: run.commitStartedAt ?? new Date(),
    ...terminalProjection(input.command, run, status),
  };
}

async function persistBatchProjection(
  tx: Transaction,
  input: ApplyBatchInput,
  run: BatchRunRecord,
  imported: number,
): Promise<FetchRunCommitResult> {
  const status = batchStatus(input.command);
  await tx.fetchRun.update({
    where: { id: input.command.runId },
    data: batchProjectionData(input, run, imported, status),
  });
  return resultFor(
    "APPLIED",
    status,
    run.importedCount + imported,
    imported,
    input.prepared.invalid,
    input.command.attemptId,
  );
}

async function persistBatch(
  tx: Transaction,
  input: ApplyBatchInput,
  run: BatchRunRecord,
): Promise<FetchRunCommitResult> {
  const imported = await persistPreparedJobImport(tx, {
    userId: run.userId,
    prepared: input.prepared,
    includeEnrichment: input.includeEnrichment,
  });
  await persistBatchReceipt(tx, input, imported);
  return persistBatchProjection(tx, input, run, imported);
}

async function applyBatch(
  tx: Transaction,
  input: ApplyBatchInput,
): Promise<FetchRunCommitResult> {
  await acquireFetchRunLifecycleLock(tx, input.command.runId);
  const run = await loadBatchRun(tx, input.command.runId);
  const prior = await loadBatchReceipt(tx, input.command);
  const replay = replayBatchReceipt(run, prior, input);
  if (replay) return replay;
  validateActiveBatchRun(run, input.command);
  validateTerminalBatch(input.command);
  validateBatchProgress(run, input.command);
  return persistBatch(tx, input, run);
}

async function applyBatchTransaction(
  input: ApplyBatchInput,
): Promise<FetchRunCommitResult> {
  return commitTransaction((tx) => applyBatch(tx, input));
}

interface CommitOwner {
  userId: string;
  market: string;
}

async function loadCommitOwner(runId: string): Promise<CommitOwner> {
  const owner = await prisma.fetchRun.findUnique({
    where: { id: runId },
    select: { userId: true, market: true },
  });
  return owner ?? runNotFound();
}

function canonicalizeBatchCommand(
  command: BatchCommand,
  owner: CommitOwner,
): BatchCommand {
  // Tenant and market are always server-derived. A remote adapter can submit
  // only discoveries; it cannot redirect them to another user or market.
  const market: "AU" | "CN" | "GLOBAL" =
    owner.market === "CN"
      ? "CN"
      : owner.market === "GLOBAL"
        ? "GLOBAL"
        : "AU";
  const items: FetchRunCommitBatchCommand["items"] = command.items.map(
    (item) => ({
      ...item,
      market,
      ...(market === "AU" ? { source: "jobspy" } : {}),
    }),
  );
  return { ...command, items };
}

async function prepareBatchInput(
  command: BatchCommand,
  owner: CommitOwner,
): Promise<ApplyBatchInput> {
  const canonicalCommand = canonicalizeBatchCommand(command, owner);
  const prepared = await prepareJobImportForUser({
    userId: owner.userId,
    items: canonicalCommand.items,
  });
  return {
    command: canonicalCommand,
    prepared,
    requestHash: hashFetchRunBatch(canonicalCommand),
    includeEnrichment: true,
  };
}

async function applyBatchWithMigrationFallback(
  input: ApplyBatchInput,
  owner: CommitOwner,
): Promise<FetchRunCommitResult> {
  try {
    return await applyBatchTransaction(input);
  } catch (error) {
    if (!isJobImportEnrichmentMigrationRace(error)) throw error;
    reportError(error, {
      scope: "fetchRuns.commit.enrichment_migration_race",
      userId: owner.userId,
      tags: {
        runId: input.command.runId,
        batchKey: input.command.batchKey,
      },
    });
    // A missing-column statement aborts PostgreSQL's transaction. Retry the
    // entire lock/read/write/receipt projection without enrichment columns.
    return applyBatchTransaction({
      ...input,
      includeEnrichment: false,
    });
  }
}

async function commitBatch(
  command: BatchCommand,
): Promise<FetchRunCommitResult> {
  const owner = await loadCommitOwner(command.runId);
  const input = await prepareBatchInput(command, owner);
  return applyBatchWithMigrationFallback(input, owner);
}

/**
 * The single execution/commit interface for remote and in-process adapters.
 * Network discovery must complete before entering this module.
 */
export async function commitFetchRun(
  command: FetchRunCommitCommand,
): Promise<FetchRunCommitResult> {
  if (command.protocol !== FETCH_RUN_COMMIT_PROTOCOL) {
    throw new Error("Unsupported FetchRun commit protocol");
  }
  if (command.command === "start") {
    return startFetchRun(command.runId, command.attemptId);
  }
  if (command.command === "fail") {
    return failFetchRun(command);
  }
  return commitBatch(command);
}
