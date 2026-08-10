/**
 * The Joblit Runner — the batch protocol's first unattended worker.
 *
 * What Codex did interactively, this does headless: claim tailoring tasks
 * from the server, generate each remaining target through the local Hermes
 * gateway on loopback, and import the result with the exact receipt and
 * TailoringRun handle the prompt endpoint issued. The browser is not
 * involved, and the Hermes key never leaves this machine — it is read from
 * local configuration and sent only to 127.0.0.1.
 *
 * Deliberately dependency-free and repo-import-free: the HTTP API is the
 * contract, same as for any external agent. See AGENTS.md.
 */

const TARGET_LABELS = { RESUME: "resume", COVER: "cover" };
const AGENT_EXECUTION_PROTOCOL_VERSION = 2;
const SUPPORTED_AGENT_EXECUTION_PROTOCOLS = new Set([1, 2]);
const DEFAULT_CANCELLATION_POLL_MS = 1_500;
const DEFAULT_SETTLEMENT_RETRY_MS = 250;
const DEFAULT_LEASE_WAIT_MAX_MS = 30_000;
const DEFAULT_EMPTY_BATCH_POLL_MS = 1_000;
const SETTLEMENT_ATTEMPTS = 3;
const ACKNOWLEDGEMENT_ATTEMPTS = 3;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION_ID_RE = /^joblit:[A-Za-z0-9:_-]{1,120}$/;
const TAILORING_RUN_STATUSES = new Set([
  "ISSUED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "PARTIAL",
]);
const TAILORING_RUN_TERMINAL_STATUSES = new Set([
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "PARTIAL",
]);
const RECOVERABLE_HERMES_PHASES = new Set([
  "starting",
  "running",
  "completed",
  "repairing",
]);
const AMBIGUOUS_HERMES_CODES = new Set([
  "HERMES_PROTOCOL_ERROR",
  "HERMES_REQUEST_TIMEOUT",
  "REPAIR_OUTCOME_UNKNOWN",
  "REPAIR_RESPONSE_INVALID",
  "REPAIR_TRANSCRIPT_INVALID",
  "RUN_OUTCOME_UNKNOWN",
  "RUN_START_UNKNOWN",
  "RUN_STATE_CONFLICT",
]);
const OPERATION_TARGET_MASKS = { resume: 1, cover: 2 };

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sleep(ms, signal) {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });

    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
  });
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function errorTelemetry(error) {
  if (!isRecord(error)) return "";
  const fields = [
    ["phase", error.phase],
    ["status", error.status],
    ["code", error.code],
    ["requestId", error.requestId],
    ["elapsedMs", error.elapsedMs],
  ]
    .filter(([, value]) =>
      typeof value === "string"
        ? value.length > 0
        : typeof value === "number" && Number.isFinite(value),
    )
    .map(([key, value]) => `${key}=${String(value)}`);
  return fields.length > 0 ? ` [${fields.join(" ")}]` : "";
}

function describeError(error) {
  return `${errorMessage(error)}${errorTelemetry(error)}`;
}

function readRecoverableOperation(value) {
  if (
    !isRecord(value) ||
    typeof value.sessionId !== "string" ||
    !SESSION_ID_RE.test(value.sessionId) ||
    Object.keys(value).length !== 3 ||
    !RECOVERABLE_HERMES_PHASES.has(value.phase) ||
    !isRecord(value.operation) ||
    Object.keys(value.operation).length !== 4 ||
    typeof value.operation.tailoringRunId !== "string" ||
    !UUID_RE.test(value.operation.tailoringRunId) ||
    typeof value.operation.attemptId !== "string" ||
    !UUID_RE.test(value.operation.attemptId) ||
    (value.operation.target !== "resume" &&
      value.operation.target !== "cover") ||
    typeof value.operation.promptHash !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.operation.promptHash)
  ) {
    throw new Error("Hermes returned invalid recovery metadata");
  }
  return value;
}

async function reconcileSettledHermesOperations({
  joblit,
  hermes,
  signal,
  retryMs,
  log,
}) {
  if (typeof hermes.recoverableOperations !== "function") return;

  let recoverable;
  try {
    recoverable = await hermes.recoverableOperations();
    if (!Array.isArray(recoverable)) {
      throw new Error("Hermes recovery list is invalid");
    }
  } catch (error) {
    log(`Recovery scan deferred: ${errorMessage(error)}`);
    return;
  }

  for (const candidate of recoverable) {
    if (signal?.aborted) return;
    let item;
    try {
      item = readRecoverableOperation(candidate);
      const snapshot = await joblit.tailoringRunStatus(
        item.operation.tailoringRunId,
        { signal },
      );
      if (
        !isRecord(snapshot) ||
        !isRecord(snapshot.run) ||
        snapshot.run.id !== item.operation.tailoringRunId ||
        typeof snapshot.run.status !== "string" ||
        !TAILORING_RUN_STATUSES.has(snapshot.run.status) ||
        !Number.isSafeInteger(snapshot.run.acceptedTargetMask) ||
        snapshot.run.acceptedTargetMask < 0 ||
        snapshot.run.acceptedTargetMask > 3
      ) {
        throw new Error("Joblit returned an invalid recovery TailoringRun");
      }

      const targetMask = OPERATION_TARGET_MASKS[item.operation.target];
      if ((snapshot.run.acceptedTargetMask & targetMask) !== 0) {
        if (item.phase === "starting" || item.phase === "running") {
          if (typeof hermes.reconcileObsolete !== "function") {
            throw new Error(
              "Hermes cannot reconcile a live obsolete recovery state",
            );
          }
          await hermes.reconcileObsolete({
            sessionId: item.sessionId,
            signal,
          });
          log(`Recovered ${item.operation.target}: import already accepted`);
          continue;
        }
        const acknowledged = await acknowledgeImport({
          hermes,
          sessionId: item.sessionId,
          signal,
          retryMs,
          log,
        });
        if (acknowledged) {
          log(`Recovered ${item.operation.target}: import already accepted`);
        }
        continue;
      }

      if (TAILORING_RUN_TERMINAL_STATUSES.has(snapshot.run.status)) {
        if (item.phase === "starting" || item.phase === "running") {
          if (typeof hermes.reconcileObsolete !== "function") {
            throw new Error(
              "Hermes cannot reconcile a live obsolete recovery state",
            );
          }
          await hermes.reconcileObsolete({
            sessionId: item.sessionId,
            signal,
          });
          log(`Discarded ${item.operation.target}: TailoringRun is terminal`);
          continue;
        }
        if (typeof hermes.discard !== "function") {
          throw new Error("Hermes cannot discard an obsolete recovery state");
        }
        await hermes.discard({ sessionId: item.sessionId });
        log(`Discarded ${item.operation.target}: TailoringRun is terminal`);
        continue;
      }

      if (
        snapshot.run.status !== "RUNNING" ||
        !isRecord(snapshot.run.handle) ||
        snapshot.run.handle.id !== item.operation.tailoringRunId ||
        snapshot.run.handle.attemptId !== item.operation.attemptId
      ) {
        throw new Error(
          "Recovery TailoringRun belongs to another execution attempt",
        );
      }
      // Still owned by the exact handle: keep starting/running/completed local
      // state until the task is reclaimed or Joblit reaches a terminal state.
    } catch (error) {
      log(`Recovery state preserved: ${errorMessage(error)}`);
    }
  }
}

function isRepairableImportError(error) {
  return (
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "INVALID_AI_RESULT"
  );
}

function isAmbiguousJoblitError(error) {
  if (!error || typeof error !== "object") return false;
  if (
    "code" in error &&
    (error.code === "JOBLIT_REQUEST_TIMEOUT" ||
      error.code === "JOBLIT_TRANSPORT_ERROR")
  ) {
    return true;
  }
  if (!("status" in error) || !Number.isInteger(error.status)) return false;
  return (
    error.status === 408 ||
    error.status === 425 ||
    error.status === 429 ||
    error.status >= 500
  );
}

const SUPERSEDED_EXECUTION_CODES = new Set([
  "TAILORING_ATTEMPT_STALE",
  "ATTEMPT_STALE",
  "BATCH_ATTEMPT_MISMATCH",
  "BATCH_TASK_NOT_RUNNING",
]);

const AUTHORITATIVE_TERMINAL_EXECUTION_CODES = new Set([
  "TAILORING_RUN_TERMINAL",
  "RUN_ALREADY_TERMINAL",
]);

function isSupersededExecutionError(error) {
  return (
    error &&
    typeof error === "object" &&
    "code" in error &&
    SUPERSEDED_EXECUTION_CODES.has(error.code)
  );
}

function isAuthoritativeTerminalExecutionError(error) {
  return (
    error &&
    typeof error === "object" &&
    "code" in error &&
    AUTHORITATIVE_TERMINAL_EXECUTION_CODES.has(error.code)
  );
}

function isAmbiguousHermesError(error) {
  if (error instanceof TypeError) return true;
  if (
    error &&
    typeof error === "object" &&
    error.code === "HERMES_HTTP_ERROR" &&
    Number.isInteger(error.status) &&
    (error.status === 408 ||
      error.status === 425 ||
      error.status === 429 ||
      error.status >= 500)
  ) {
    return true;
  }
  return (
    error &&
    typeof error === "object" &&
    "code" in error &&
    AMBIGUOUS_HERMES_CODES.has(error.code)
  );
}

function importSettlementUnknown(cause) {
  const error = new Error(
    "Joblit import settlement is unknown; the exact receipt will be replayed on recovery",
    { cause },
  );
  error.code = "IMPORT_SETTLEMENT_UNKNOWN";
  for (const field of ["phase", "status", "requestId", "elapsedMs"]) {
    if (isRecord(cause) && cause[field] !== undefined) {
      error[field] = cause[field];
    }
  }
  return error;
}

function publicationSettlementUnknown(cause) {
  const error = new Error(
    "Joblit publication settlement is unknown; the exact publication receipt will be replayed on recovery",
    { cause },
  );
  error.code = "PUBLICATION_SETTLEMENT_UNKNOWN";
  for (const field of ["phase", "status", "requestId", "elapsedMs"]) {
    if (isRecord(cause) && cause[field] !== undefined) {
      error[field] = cause[field];
    }
  }
  return error;
}

async function settleImport({
  joblit,
  request,
  finalize = true,
  signal,
  retryMs,
  log,
}) {
  for (let attempt = 1; attempt <= SETTLEMENT_ATTEMPTS; attempt += 1) {
    try {
      return await joblit.importGeneration(request, { finalize });
    } catch (error) {
      if (!isAmbiguousJoblitError(error)) throw error;
      if (signal?.aborted) throw error;
      if (attempt === SETTLEMENT_ATTEMPTS) {
        throw importSettlementUnknown(error);
      }
      log(
        `  import response unknown; replaying the same receipt (${attempt + 1}/${SETTLEMENT_ATTEMPTS})`,
      );
      await sleep(retryMs * attempt, signal);
    }
  }
}

async function settlePublication({ joblit, request, signal, retryMs, log }) {
  for (let attempt = 1; attempt <= SETTLEMENT_ATTEMPTS; attempt += 1) {
    try {
      return await joblit.publishGeneration(request);
    } catch (error) {
      if (!isAmbiguousJoblitError(error)) throw error;
      if (signal?.aborted) throw error;
      if (attempt === SETTLEMENT_ATTEMPTS) {
        throw publicationSettlementUnknown(error);
      }
      log(
        `  publication response unknown${errorTelemetry(error)}; replaying the exact receipt (${attempt + 1}/${SETTLEMENT_ATTEMPTS})`,
      );
      await sleep(retryMs * attempt, signal);
    }
  }
}

function readDraftImport(value) {
  if (
    !isRecord(value) ||
    typeof value.applicationId !== "string" ||
    value.applicationId.length === 0 ||
    typeof value.aiContentHash !== "string" ||
    value.aiContentHash.length === 0
  ) {
    const error = new Error(
      "Joblit draft import did not return its durable Application identity",
    );
    error.code = "DRAFT_IMPORT_RESPONSE_INVALID";
    throw error;
  }
  return value;
}

function publicationRequest({ task, target, application, handle }) {
  if (!isRecord(handle) || !handle.id || !handle.attemptId) {
    const error = new Error(
      "Joblit did not return the Tailoring Run handle required for publication",
    );
    error.code = "PUBLICATION_HANDLE_MISSING";
    throw error;
  }
  if (
    !isRecord(application) ||
    typeof application.applicationId !== "string" ||
    typeof application.aiContentHash !== "string"
  ) {
    const error = new Error(
      "Joblit did not return the durable Application required for publication",
    );
    error.code = "PUBLICATION_APPLICATION_MISSING";
    throw error;
  }
  return {
    applicationId: application.applicationId,
    expectedHash: application.aiContentHash,
    runId: handle.id,
    attemptId: handle.attemptId,
    target,
    batchAttemptId: task.attemptId,
  };
}

async function acknowledgeImport({ hermes, sessionId, signal, retryMs, log }) {
  for (let attempt = 1; attempt <= ACKNOWLEDGEMENT_ATTEMPTS; attempt += 1) {
    try {
      await hermes.acknowledge({ sessionId });
      return true;
    } catch (error) {
      if (attempt === ACKNOWLEDGEMENT_ATTEMPTS || signal?.aborted) {
        log(`  local Hermes cleanup deferred: ${errorMessage(error)}`);
        return false;
      }
      await sleep(retryMs * attempt, signal);
    }
  }
}

function repairFeedback(error, target) {
  return [
    `Joblit rejected the ${target} result: ${errorMessage(error)}`,
    "Return corrected JSON only. Preserve the original request and evidence; do not add commentary or markdown.",
  ]
    .join("\n")
    .slice(0, 1_200);
}

function validateIssuedPrompt(value) {
  if (
    !isRecord(value) ||
    !isRecord(value.prompt) ||
    typeof value.prompt.systemPrompt !== "string" ||
    value.prompt.systemPrompt.length === 0 ||
    typeof value.prompt.userPrompt !== "string" ||
    value.prompt.userPrompt.length === 0 ||
    !isRecord(value.promptMeta) ||
    typeof value.promptMeta.promptHash !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.promptMeta.promptHash) ||
    !isRecord(value.tailoringRun) ||
    typeof value.tailoringRun.id !== "string" ||
    !UUID_RE.test(value.tailoringRun.id) ||
    typeof value.tailoringRun.attemptId !== "string" ||
    !UUID_RE.test(value.tailoringRun.attemptId)
  ) {
    throw new Error("Joblit returned an invalid Agent prompt envelope");
  }
  return value;
}

function readTailoringRunStatus(value, expectedHandle) {
  if (
    !isRecord(value) ||
    !isRecord(value.run) ||
    value.run.id !== expectedHandle.id ||
    typeof value.run.status !== "string" ||
    !TAILORING_RUN_STATUSES.has(value.run.status)
  ) {
    const error = new Error("Joblit returned an invalid TailoringRun status");
    error.code = "TAILORING_STATUS_INVALID";
    throw error;
  }
  if (!TAILORING_RUN_TERMINAL_STATUSES.has(value.run.status)) {
    if (value.run.status !== "RUNNING" || !isRecord(value.run.handle)) {
      const error = new Error(
        "Joblit returned a non-running TailoringRun without its active handle",
      );
      error.code = "TAILORING_STATUS_INVALID";
      throw error;
    }
    if (
      value.run.handle.id !== expectedHandle.id ||
      value.run.handle.attemptId !== expectedHandle.attemptId
    ) {
      const error = new Error(
        "Tailoring run was superseded by a newer execution attempt",
      );
      error.code = "TAILORING_ATTEMPT_STALE";
      throw error;
    }
  }
  return value.run;
}

function terminalTailoringError(run) {
  if (!TAILORING_RUN_TERMINAL_STATUSES.has(run.status)) return null;
  const cancelled =
    run.status === "CANCELLED" ||
    run.errorCode === "TAILORING_CANCELLED" ||
    run.errorCode === "BATCH_CANCELLED";
  const error = new Error(
    cancelled
      ? "Tailoring run was cancelled"
      : `Tailoring run became ${run.status.toLowerCase()}`,
  );
  error.code = cancelled ? "TAILORING_CANCELLED" : "TAILORING_RUN_TERMINAL";
  error.status = run.status;
  return error;
}

/**
 * Run one Hermes operation while polling the server-owned TailoringRun.
 * Cancelling the batch or run aborts the local request and therefore reaches
 * Hermes `/stop`; a failed status poll also fails closed instead of silently
 * ignoring a user's cancellation.
 */
async function withTailoringControl({
  joblit,
  handle,
  signal,
  pollMs,
  operation,
}) {
  const initial = readTailoringRunStatus(
    await joblit.tailoringRunStatus(handle.id, { signal }),
    handle,
  );
  const initialTerminal = terminalTailoringError(initial);
  if (initialTerminal) throw initialTerminal;

  const serverAbort = new AbortController();
  const monitorStop = new AbortController();
  const controlledSignal = signal
    ? AbortSignal.any([signal, serverAbort.signal])
    : serverAbort.signal;
  let terminalError = null;
  let monitorError = null;

  const monitor = (async () => {
    while (!monitorStop.signal.aborted) {
      await sleep(pollMs, monitorStop.signal);
      if (monitorStop.signal.aborted) return;
      try {
        const run = readTailoringRunStatus(
          await joblit.tailoringRunStatus(handle.id, {
            signal: monitorStop.signal,
          }),
          handle,
        );
        const terminal = terminalTailoringError(run);
        if (terminal) {
          terminalError = terminal;
          serverAbort.abort();
          return;
        }
      } catch (error) {
        if (monitorStop.signal.aborted) return;
        monitorError = error;
        serverAbort.abort();
        return;
      }
    }
  })();

  try {
    const result = await operation(controlledSignal);
    if (terminalError) throw terminalError;
    if (monitorError) throw monitorError;
    return result;
  } catch (error) {
    if (terminalError) throw terminalError;
    if (monitorError) throw monitorError;
    throw error;
  } finally {
    monitorStop.abort();
    await monitor;
  }
}

/**
 * Drain the user's active batch: claim one task per round trip, generate its
 * remaining targets, settle by importing (success is implicit in the batch
 * protocol — completedTasks carries only FAILED and SKIPPED), and report
 * failures on the next claim.
 *
 * @param {{
 *   joblit: {
 *     activeBatch(): Promise<{ batchId: string | null, status?: string }>,
 *     runOnce(batchId: string, body: { completedTasks: Array<object> }): Promise<{
 *       batch: { id: string, status: string },
 *       tasks: Array<{
 *         taskId: string,
 *         attemptId: string,
 *         issueKey: string,
 *         protocolVersion: 1 | 2,
 *         delivery?: "FINAL" | "DRAFT",
 *         jobId: string,
 *         remainingTargets: Array<"RESUME" | "COVER">,
 *         remainingPublicationTargets?: Array<"RESUME" | "COVER">,
 *         applicationId?: string | null,
 *         applicationAiContentHash?: string | null,
 *         tailoringRun?: { id: string, attemptId: string } | null,
 *         job?: { title?: string, company?: string | null },
 *       }>,
 *       execution: {
 *         stopReason: string | null,
 *         retryAfterMs?: number | null,
 *         earliestLeaseExpiresAt?: string | null,
 *       },
 *     }>,
 *     prompt(request: object): Promise<{
 *       prompt: { systemPrompt: string, userPrompt: string },
 *       promptMeta: object,
 *       tailoringRun?: object,
 *     }>,
 *     importGeneration(request: object, options?: { finalize?: boolean }): Promise<unknown>,
 *     publishGeneration?(request: object): Promise<unknown>,
 *     releaseTask?(batchId: string, request: object): Promise<unknown>,
 *     tailoringRunStatus(runId: string, options?: { signal?: AbortSignal }): Promise<object>,
 *   },
 *   hermes: {
 *     generate(run: { instructions: string, input: string, sessionId: string, operation: { tailoringRunId: string, attemptId: string, target: "resume" | "cover", promptHash: string } }): Promise<string>,
 *     repair(run: { sessionId: string, feedback: string }): Promise<string>,
 *     acknowledge(run: { sessionId: string }): Promise<void>,
 *     discard?(run: { sessionId: string }): Promise<void>,
 *     recoverableOperations?(): Promise<Array<object>>,
 *   },
 *   signal?: AbortSignal,
 *   cancelPollMs?: number,
 *   settlementRetryMs?: number,
 *   leaseWaitMaxMs?: number,
 *   wait?: (ms: number, signal?: AbortSignal) => Promise<void>,
 *   log?: (message: string) => void,
 * }} deps
 */
export async function processActiveBatch({
  joblit,
  hermes,
  signal,
  cancelPollMs = DEFAULT_CANCELLATION_POLL_MS,
  settlementRetryMs = DEFAULT_SETTLEMENT_RETRY_MS,
  leaseWaitMaxMs = DEFAULT_LEASE_WAIT_MAX_MS,
  wait = sleep,
  log = console.log,
}) {
  const summary = { succeeded: 0, failed: 0, deferred: 0, batchId: null };

  await reconcileSettledHermesOperations({
    joblit,
    hermes,
    signal,
    retryMs: settlementRetryMs,
    log,
  });
  if (signal?.aborted) return summary;

  const active = await joblit.activeBatch();
  if (!active.batchId) {
    log("No active batch. Select jobs in Joblit and queue a generation batch.");
    return summary;
  }
  summary.batchId = active.batchId;
  log(`Working batch ${active.batchId}`);

  /** @type {Array<{ taskId: string, attemptId: string, status: "FAILED" | "SKIPPED", error?: string }>} */
  let completedTasks = [];

  for (;;) {
    if (signal?.aborted) return summary;
    const round = await joblit.runOnce(active.batchId, { completedTasks });
    completedTasks = [];

    const task = round.tasks[0];
    if (!task) {
      if (
        round.batch.status === "SUCCEEDED" ||
        round.batch.status === "FAILED" ||
        round.batch.status === "CANCELLED" ||
        round.batch.status === "COMPLETED"
      ) {
        log(
          `Batch ${round.batch.status.toLowerCase()}; nothing left to claim.`,
        );
        return summary;
      }
      const retryAfterMs =
        Number.isSafeInteger(round.execution?.retryAfterMs) &&
        round.execution.retryAfterMs > 0
          ? round.execution.retryAfterMs
          : DEFAULT_EMPTY_BATCH_POLL_MS;
      const waitMs = Math.min(
        Math.max(1, retryAfterMs),
        Math.max(1, leaseWaitMaxMs),
      );
      log(
        `Batch ${round.batch.status.toLowerCase()}; another task lease is active, retrying in ${waitMs}ms.`,
      );
      await wait(waitMs, signal);
      continue;
    }

    const label = task.job?.title
      ? `${task.job.title}${task.job.company ? ` @ ${task.job.company}` : ""}`
      : task.jobId;
    const pendingWork = [
      ...task.remainingTargets,
      ...(task.remainingPublicationTargets ?? []).map(
        (target) => `${target} publication`,
      ),
    ];
    log(`Task ${task.taskId} (${label}): ${pendingWork.join(", ")}`);

    try {
      if (!SUPPORTED_AGENT_EXECUTION_PROTOCOLS.has(task.protocolVersion)) {
        throw new Error(
          `Unsupported Agent execution protocol ${String(task.protocolVersion)}`,
        );
      }
      if (
        task.protocolVersion === 2 &&
        (task.remainingPublicationTargets?.length ?? 0) > 0
      ) {
        if (typeof joblit.publishGeneration !== "function") {
          throw new Error(
            `Agent execution protocol ${AGENT_EXECUTION_PROTOCOL_VERSION} requires target publication`,
          );
        }
        for (const remaining of task.remainingPublicationTargets) {
          const target = TARGET_LABELS[remaining];
          if (!target)
            throw new Error(`Unknown publication target ${remaining}`);
          await settlePublication({
            joblit,
            request: publicationRequest({
              task,
              target,
              application: {
                applicationId: task.applicationId,
                aiContentHash: task.applicationAiContentHash,
              },
              handle: task.tailoringRun,
            }),
            signal,
            retryMs: settlementRetryMs,
            log,
          });
          log(`  ${target}: published`);
        }
      }
      for (const remaining of task.remainingTargets) {
        const target = TARGET_LABELS[remaining];
        if (!target) throw new Error(`Unknown target ${remaining}`);

        const delivery = task.delivery ?? "FINAL";
        const issued = validateIssuedPrompt(
          await joblit.prompt({
            jobId: task.jobId,
            target,
            source: "codex_batch",
            delivery,
            protocolVersion: task.protocolVersion,
            issueKey: task.issueKey,
            batchId: active.batchId,
            batchTaskId: task.taskId,
            batchAttemptId: task.attemptId,
          }),
        );

        // Resume and Cover are independent model transactions. Separate
        // sessions prevent cross-target context leakage and give each target
        // its own single-repair allowance.
        const sessionId = `joblit:${task.taskId}:${target}`;
        let modelOutput = await withTailoringControl({
          joblit,
          handle: issued.tailoringRun,
          signal,
          pollMs: cancelPollMs,
          operation: (controlledSignal) =>
            hermes.generate({
              instructions: issued.prompt.systemPrompt,
              input: issued.prompt.userPrompt,
              sessionId,
              operation: {
                tailoringRunId: issued.tailoringRun.id,
                attemptId: issued.tailoringRun.attemptId,
                target,
                promptHash: issued.promptMeta.promptHash,
              },
              signal: controlledSignal,
            }),
        });

        // The receipt and handle go back verbatim: the server verifies the
        // import against exactly what it issued, and any local edit would be
        // rejected as a receipt mismatch.
        const importRequest = {
          jobId: task.jobId,
          target,
          source: "codex_batch",
          promptMeta: issued.promptMeta,
          ...(issued.tailoringRun ? { tailoringRun: issued.tailoringRun } : {}),
        };
        let importResult;
        try {
          importResult = await settleImport({
            joblit,
            request: { ...importRequest, modelOutput },
            finalize: delivery === "FINAL",
            signal,
            retryMs: settlementRetryMs,
            log,
          });
        } catch (error) {
          if (
            !isRepairableImportError(error) ||
            typeof hermes.repair !== "function"
          ) {
            throw error;
          }
          modelOutput = await withTailoringControl({
            joblit,
            handle: issued.tailoringRun,
            signal,
            pollMs: cancelPollMs,
            operation: (controlledSignal) =>
              hermes.repair({
                sessionId,
                feedback: repairFeedback(error, target),
                signal: controlledSignal,
              }),
          });
          importResult = await settleImport({
            joblit,
            request: { ...importRequest, modelOutput },
            finalize: delivery === "FINAL",
            signal,
            retryMs: settlementRetryMs,
            log,
          });
        }
        // A successful import is the authoritative commit. Local state
        // cleanup must never reverse it into a server-side task failure.
        await acknowledgeImport({
          hermes,
          sessionId,
          signal,
          retryMs: settlementRetryMs,
          log,
        });
        log(`  ${target}: imported`);
        if (delivery === "DRAFT") {
          if (typeof joblit.publishGeneration !== "function") {
            throw new Error(
              `Agent execution protocol ${AGENT_EXECUTION_PROTOCOL_VERSION} requires target publication`,
            );
          }
          const durableApplication = readDraftImport(importResult);
          await settlePublication({
            joblit,
            request: publicationRequest({
              task,
              target,
              application: durableApplication,
              handle: issued.tailoringRun,
            }),
            signal,
            retryMs: settlementRetryMs,
            log,
          });
          log(`  ${target}: published`);
        }
      }
      // Success is settled by the imports themselves; nothing to report.
      summary.succeeded += 1;
    } catch (error) {
      if (signal?.aborted) return summary;
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error.code === "TAILORING_CANCELLED" || error.code === "RUN_CANCELLED")
      ) {
        log(`  stopped: ${errorMessage(error)}`);
        return summary;
      }
      if (isAuthoritativeTerminalExecutionError(error)) {
        log(`  stopped: ${errorMessage(error)}`);
        continue;
      }
      if (
        isSupersededExecutionError(error) ||
        (error &&
          typeof error === "object" &&
          "code" in error &&
          (error.code === "IMPORT_SETTLEMENT_UNKNOWN" ||
            error.code === "PUBLICATION_SETTLEMENT_UNKNOWN" ||
            error.code === "TAILORING_STATUS_INVALID")) ||
        isAmbiguousHermesError(error) ||
        isAmbiguousJoblitError(error)
      ) {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "PUBLICATION_SETTLEMENT_UNKNOWN" &&
          typeof joblit.releaseTask === "function"
        ) {
          try {
            await joblit.releaseTask(active.batchId, {
              taskId: task.taskId,
              attemptId: task.attemptId,
              reason: "PUBLICATION_SETTLEMENT_UNKNOWN",
            });
          } catch (releaseError) {
            log(`  release deferred: ${describeError(releaseError)}`);
          }
        }
        log(`  deferred: ${describeError(error)}`);
        summary.deferred += 1;
        return summary;
      }
      const reason = describeError(error);
      log(`  FAILED: ${reason}`);
      completedTasks = [
        {
          taskId: task.taskId,
          attemptId: task.attemptId,
          status: "FAILED",
          error: reason.slice(0, 500),
        },
      ];
      summary.failed += 1;
    }
  }
}
