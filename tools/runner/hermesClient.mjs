import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { createRequestDeadline } from "./requestDeadline.mjs";

/**
 * Minimal Hermes gateway client for the Runner.
 *
 * Uses the Hermes gateway protocol: POST /v1/runs with
 * `{instructions, input, session_id}` and a Bearer key, then poll
 * GET /v1/runs/{id} until `completed` or `failed`.
 *
 * The gateway must be loopback. The key is a local credential; sending it
 * anywhere else would turn a configuration typo into credential
 * exfiltration, so the client refuses to construct at all.
 */

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const RUN_ID_RE = /^run_[0-9a-f]{32}$/;
const SESSION_ID_RE = /^joblit:[A-Za-z0-9:_-]{1,120}$/;
const RUN_STATUSES = new Set([
  "queued",
  "running",
  "waiting_for_approval",
  "stopping",
  "completed",
  "failed",
  "cancelled",
]);
const MAX_MODEL_OUTPUT_CHARS = 80_000;
const DEFAULT_TIMEOUT_MS = 240_000;
const DEFAULT_POLL_MS = 1_500;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const MAX_RECONCILIATION_WAIT_MS = 30_000;
const FEEDBACK_HASH_RE = /^[0-9a-f]{64}$/;
const CONTENT_HASH_RE = /^[0-9a-f]{64}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROMPT_HASH_RE = /^[0-9a-f]{64}$/;
const OPERATION_TARGETS = new Set(["resume", "cover"]);

export class HermesClientError extends Error {
  constructor(code, message, { status, cause } = {}) {
    super(message);
    this.name = "HermesClientError";
    this.code = code;
    this.status = status;
    if (cause !== undefined) this.cause = cause;
  }
}

function readRunSnapshot(run, runId) {
  if (
    !run ||
    run.object !== "hermes.run" ||
    run.run_id !== runId ||
    typeof run.status !== "string" ||
    !RUN_STATUSES.has(run.status) ||
    (run.output !== undefined &&
      (typeof run.output !== "string" ||
        run.output.length > MAX_MODEL_OUTPUT_CHARS)) ||
    (run.error !== undefined && typeof run.error !== "string")
  ) {
    throw new HermesClientError(
      "HERMES_PROTOCOL_ERROR",
      "Hermes run response is invalid",
    );
  }
  return run;
}

function sleep(ms, signal) {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms));
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });

    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}

function assertValidOperation(operation) {
  if (
    !operation ||
    typeof operation !== "object" ||
    Array.isArray(operation) ||
    Object.keys(operation).length !== 4 ||
    typeof operation.tailoringRunId !== "string" ||
    !UUID_RE.test(operation.tailoringRunId) ||
    typeof operation.attemptId !== "string" ||
    !UUID_RE.test(operation.attemptId) ||
    !OPERATION_TARGETS.has(operation.target) ||
    typeof operation.promptHash !== "string" ||
    !PROMPT_HASH_RE.test(operation.promptHash)
  ) {
    throw new HermesClientError(
      "RUN_OPERATION_INVALID",
      "Hermes operation recovery metadata is invalid",
    );
  }
}

function sameOperationWork(left, right) {
  return (
    left.tailoringRunId === right.tailoringRunId &&
    left.target === right.target &&
    left.promptHash === right.promptHash
  );
}

function withOperation(state, operation) {
  return operation ? { ...state, operation } : state;
}

function hashText(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hashRequest(instructions, input) {
  return hashText(JSON.stringify([instructions, input]));
}

function hasStartRecoveryMetadata(state) {
  return (
    Number.isSafeInteger(state?.baselineMessageId) &&
    state.baselineMessageId >= 0 &&
    typeof state.requestHash === "string" &&
    CONTENT_HASH_RE.test(state.requestHash) &&
    typeof state.inputHash === "string" &&
    CONTENT_HASH_RE.test(state.inputHash)
  );
}

function hasAnyStartRecoveryMetadata(state) {
  return (
    "baselineMessageId" in state ||
    "requestHash" in state ||
    "inputHash" in state
  );
}

function assertValidRunState(state) {
  if (state === null) return;
  const isObject = state !== null && typeof state === "object";
  const validBase =
    isObject &&
    typeof state.repairUsed === "boolean" &&
    (state.phase === "idle" ||
      state.phase === "starting" ||
      state.phase === "running" ||
      state.phase === "completed" ||
      state.phase === "repairing");
  const ownsValidRunId =
    typeof state?.runId === "string" && RUN_ID_RE.test(state.runId);
  const ownsStartRecoveryMetadata = isObject && hasStartRecoveryMetadata(state);
  const ownsAnyStartRecoveryMetadata =
    isObject && hasAnyStartRecoveryMetadata(state);
  const validExecutionIdentity =
    isObject &&
    (state.phase === "running"
      ? ownsValidRunId && !ownsAnyStartRecoveryMetadata
      : state.phase === "completed"
        ? (ownsValidRunId && !ownsAnyStartRecoveryMetadata) ||
          (!("runId" in state) && ownsStartRecoveryMetadata)
        : state.phase === "repairing"
          ? (ownsValidRunId &&
              !("requestHash" in state) &&
              !("inputHash" in state)) ||
            (!("runId" in state) &&
              typeof state.requestHash === "string" &&
              CONTENT_HASH_RE.test(state.requestHash) &&
              typeof state.inputHash === "string" &&
              CONTENT_HASH_RE.test(state.inputHash))
          : state.phase === "starting"
            ? !("runId" in state) &&
              (!ownsAnyStartRecoveryMetadata || ownsStartRecoveryMetadata)
            : !("runId" in state) && !ownsAnyStartRecoveryMetadata);
  const validRepairMetadata =
    isObject &&
    (state.phase === "repairing"
      ? state.repairUsed === true &&
        typeof state.feedbackHash === "string" &&
        FEEDBACK_HASH_RE.test(state.feedbackHash) &&
        Number.isSafeInteger(state.baselineMessageId) &&
        state.baselineMessageId > 0
      : !("feedbackHash" in state));
  const allowedKeys = new Set(["phase", "repairUsed"]);
  if (state?.phase === "running" || ownsValidRunId) {
    allowedKeys.add("runId");
  }
  if (
    state?.phase === "starting" ||
    state?.phase === "completed" ||
    state?.phase === "repairing"
  ) {
    allowedKeys.add("baselineMessageId");
    allowedKeys.add("requestHash");
    allowedKeys.add("inputHash");
  }
  if (state?.phase === "repairing") {
    allowedKeys.add("feedbackHash");
  }
  const mayOwnOperation =
    state?.phase === "starting" ||
    state?.phase === "running" ||
    state?.phase === "completed" ||
    state?.phase === "repairing";
  if (mayOwnOperation) allowedKeys.add("operation");
  const validOperation =
    isObject &&
    (!("operation" in state) ||
      (mayOwnOperation &&
        (() => {
          try {
            assertValidOperation(state.operation);
            return true;
          } catch {
            return false;
          }
        })()));
  const hasOnlyAllowedKeys =
    isObject && Object.keys(state).every((key) => allowedKeys.has(key));
  if (
    !validBase ||
    !validExecutionIdentity ||
    !validRepairMetadata ||
    !validOperation ||
    !hasOnlyAllowedKeys
  ) {
    throw new HermesClientError(
      "RUN_STATE_INVALID",
      "Persisted Hermes run state is invalid; refusing to start duplicate work",
    );
  }
}

export function createMemoryRunStateStore() {
  const state = new Map();
  return {
    async get(sessionId) {
      return state.get(sessionId) ?? null;
    },
    async set(sessionId, value) {
      state.set(sessionId, structuredClone(value));
    },
    async compareAndSet(sessionId, expectedValue, nextValue) {
      const current = state.get(sessionId) ?? null;
      if (!isDeepStrictEqual(current, expectedValue)) return false;
      if (nextValue === null) state.delete(sessionId);
      else state.set(sessionId, structuredClone(nextValue));
      return true;
    },
    async delete(sessionId) {
      state.delete(sessionId);
    },
    async list() {
      return [...state].map(([sessionId, value]) => ({
        sessionId,
        state: structuredClone(value),
      }));
    },
  };
}

export function createHermesClient({
  baseUrl,
  apiKey,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  pollMs = DEFAULT_POLL_MS,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  repairTimeoutMs = DEFAULT_TIMEOUT_MS,
  runStateStore = createMemoryRunStateStore(),
}) {
  const parsed = new URL(baseUrl);
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new Error(
      `Hermes gateway must be loopback; refusing ${parsed.hostname}. The API key never leaves this machine.`,
    );
  }
  if (!apiKey) throw new Error("HERMES_KEY is required");
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs <= 0) {
    throw new Error("Hermes request timeout must be a positive integer");
  }
  if (!Number.isSafeInteger(repairTimeoutMs) || repairTimeoutMs <= 0) {
    throw new Error("Hermes repair timeout must be a positive integer");
  }
  const base = `${parsed.origin}`;

  async function compareAndSetRunState(sessionId, expectedValue, nextValue) {
    if (typeof runStateStore.compareAndSet === "function") {
      return runStateStore.compareAndSet(sessionId, expectedValue, nextValue);
    }
    // Compatibility for injected test/first-release stores. The production
    // file store and the default memory store provide an atomic CAS.
    const current = await runStateStore.get(sessionId);
    if (!isDeepStrictEqual(current, expectedValue)) return false;
    if (nextValue === null && typeof runStateStore.delete === "function") {
      await runStateStore.delete(sessionId);
    } else if (nextValue === null) {
      await runStateStore.set(sessionId, {
        phase: "idle",
        repairUsed: expectedValue?.repairUsed === true,
      });
    } else {
      await runStateStore.set(sessionId, nextValue);
    }
    return true;
  }

  async function request(
    path,
    init = {},
    timeoutOverrideMs = requestTimeoutMs,
  ) {
    const upstreamSignal = init.signal;
    const deadline = createRequestDeadline(timeoutOverrideMs);
    const signal = upstreamSignal
      ? AbortSignal.any([upstreamSignal, deadline.signal])
      : deadline.signal;
    try {
      const response = await fetchImpl(`${base}${path}`, {
        ...init,
        signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          ...(init.headers ?? {}),
        },
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        let message = `Hermes HTTP ${response.status}`;
        if (body && typeof body === "object") {
          if (typeof body.error === "string") {
            message = body.error;
          } else if (
            body.error &&
            typeof body.error === "object" &&
            typeof body.error.message === "string"
          ) {
            message = body.error.message;
          }
        }
        throw new HermesClientError("HERMES_HTTP_ERROR", message, {
          status: response.status,
        });
      }
      return body;
    } catch (error) {
      if (upstreamSignal?.aborted) throw error;
      if (deadline.expired()) {
        throw new HermesClientError(
          "HERMES_REQUEST_TIMEOUT",
          `Hermes request timed out after ${timeoutOverrideMs}ms`,
          { cause: error },
        );
      }
      throw error;
    } finally {
      deadline.dispose();
    }
  }

  async function clearRunState(sessionId, repairUsed, expectedState) {
    if (expectedState !== undefined) {
      const cleared = await compareAndSetRunState(
        sessionId,
        expectedState,
        null,
      );
      if (!cleared) {
        throw new HermesClientError(
          "RUN_STATE_CONFLICT",
          "Hermes recovery state changed before it could be cleared",
        );
      }
      return;
    }
    if (typeof runStateStore.delete === "function") {
      await runStateStore.delete(sessionId);
      return;
    }
    // Compatibility for injected stores created against the first Runner
    // release. The production file store deletes settled rows.
    await runStateStore.set(sessionId, { phase: "idle", repairUsed });
  }

  function hashFeedback(feedback) {
    return hashText(feedback);
  }

  async function readSessionMessages(
    sessionId,
    signal,
    {
      allowMissing = false,
      allowEmpty = false,
      invalidCode = "REPAIR_TRANSCRIPT_INVALID",
    } = {},
  ) {
    let transcript;
    try {
      transcript = await request(
        `/api/sessions/${encodeURIComponent(sessionId)}/messages`,
        { signal },
      );
    } catch (error) {
      if (
        allowMissing &&
        error instanceof HermesClientError &&
        error.code === "HERMES_HTTP_ERROR" &&
        error.status === 404
      ) {
        return [];
      }
      throw error;
    }
    if (
      !transcript ||
      transcript.object !== "list" ||
      transcript.session_id !== sessionId ||
      !Array.isArray(transcript.data) ||
      (!allowEmpty && transcript.data.length === 0)
    ) {
      throw new HermesClientError(
        invalidCode,
        "Hermes session transcript response is invalid",
      );
    }
    let previousId = 0;
    for (const message of transcript.data) {
      if (
        !message ||
        typeof message !== "object" ||
        !Number.isSafeInteger(message.id) ||
        message.id <= previousId ||
        !["system", "user", "assistant", "tool"].includes(message.role) ||
        (message.content !== null &&
          message.content !== undefined &&
          typeof message.content !== "string")
      ) {
        throw new HermesClientError(
          invalidCode,
          "Hermes session transcript response is invalid",
        );
      }
      previousId = message.id;
    }
    return transcript.data;
  }

  function assertSameReservedRequest(state, instructions, input) {
    if (
      state.requestHash !== hashRequest(instructions, input) ||
      state.inputHash !== hashText(input)
    ) {
      throw new HermesClientError(
        "RUN_REQUEST_MISMATCH",
        "The recoverable Hermes start belongs to a different prompt request",
      );
    }
  }

  function isDefinitiveStartRejection(error) {
    return (
      error instanceof HermesClientError &&
      error.code === "HERMES_HTTP_ERROR" &&
      Number.isInteger(error.status) &&
      error.status >= 400 &&
      error.status < 500 &&
      error.status !== 408
    );
  }

  function isProvableTerminalAssistantOutput(message) {
    if (
      message.role !== "assistant" ||
      typeof message.content !== "string" ||
      message.content.length === 0 ||
      message.content.length > MAX_MODEL_OUTPUT_CHARS
    ) {
      return false;
    }

    // Stock Hermes persists assistant tool-call turns before executing their
    // side effects. That makes a non-empty interim assistant row observable
    // while the run is still live. It is never safe to treat such a snapshot as
    // the terminal model result merely because no later row has landed yet.
    if (
      Object.prototype.hasOwnProperty.call(message, "tool_calls") &&
      message.tool_calls !== null &&
      message.tool_calls !== undefined &&
      (!Array.isArray(message.tool_calls) || message.tool_calls.length > 0)
    ) {
      return false;
    }

    // Hermes' persisted terminal assistant shape uses finish_reason="stop".
    // Older transcript rows may omit the additive field, but every observable
    // non-terminal/truncated/refused reason must fail closed.
    if (
      Object.prototype.hasOwnProperty.call(message, "finish_reason") &&
      message.finish_reason !== undefined &&
      message.finish_reason !== "stop"
    ) {
      return false;
    }

    return true;
  }

  async function proveStartedRunTerminal(sessionId, state, signal) {
    if (!hasStartRecoveryMetadata(state)) {
      throw new HermesClientError(
        "RUN_START_UNKNOWN",
        "The legacy Hermes start has no transcript baseline; refusing to guess its outcome",
      );
    }
    const messages = await readSessionMessages(sessionId, signal, {
      allowMissing: true,
      allowEmpty: true,
      invalidCode: "HERMES_PROTOCOL_ERROR",
    });
    const afterBaseline = messages.filter(
      (message) => message.id > state.baselineMessageId,
    );
    const userMessages = afterBaseline.filter(
      (message) => message.role === "user",
    );
    const matchingInputs = userMessages.filter(
      (message) =>
        typeof message.content === "string" &&
        hashText(message.content) === state.inputHash,
    );
    if (userMessages.length !== 1 || matchingInputs.length !== 1) {
      throw new HermesClientError(
        "RUN_START_UNKNOWN",
        "Hermes start transcript does not prove one matching model turn",
      );
    }
    const inputMessage = matchingInputs[0];
    if (
      afterBaseline.some(
        (message) =>
          message.id < inputMessage.id &&
          (message.role === "assistant" || message.role === "tool"),
      ) ||
      afterBaseline.some(
        (message) => message.id > inputMessage.id && message.role === "system",
      )
    ) {
      throw new HermesClientError(
        "RUN_START_UNKNOWN",
        "Hermes start transcript contains an ambiguous turn boundary",
      );
    }
    const assistantOutputs = afterBaseline.filter(
      (message) =>
        message.id > inputMessage.id &&
        isProvableTerminalAssistantOutput(message),
    );
    const output = assistantOutputs[0];
    const trailingTurnMessages = output
      ? afterBaseline.filter(
          (message) =>
            message.id > output.id &&
            (message.role === "assistant" || message.role === "tool"),
        )
      : [];
    if (assistantOutputs.length !== 1 || trailingTurnMessages.length !== 0) {
      throw new HermesClientError(
        "RUN_START_UNKNOWN",
        "Hermes start has no uniquely provable assistant output",
      );
    }
    return output.content;
  }

  async function recoverStartedRun(
    sessionId,
    state,
    instructions,
    input,
    signal,
  ) {
    assertSameReservedRequest(state, instructions, input);
    const output = await proveStartedRunTerminal(sessionId, state, signal);

    if (state.phase === "completed") return output;
    if (state.phase !== "starting") {
      throw new HermesClientError(
        "RUN_STATE_CONFLICT",
        "Hermes transcript recovery state changed unexpectedly",
      );
    }
    const completedState = withOperation(
      {
        phase: "completed",
        repairUsed: state.repairUsed,
        baselineMessageId: state.baselineMessageId,
        requestHash: state.requestHash,
        inputHash: state.inputHash,
      },
      state.operation,
    );
    const recorded = await compareAndSetRunState(
      sessionId,
      state,
      completedState,
    );
    if (!recorded) {
      const concurrentState = await runStateStore.get(sessionId);
      assertValidRunState(concurrentState);
      if (!isDeepStrictEqual(concurrentState, completedState)) {
        throw new HermesClientError(
          "RUN_STATE_CONFLICT",
          "Hermes transcript was recovered, but its durable state changed unexpectedly",
        );
      }
    }
    return output;
  }

  async function recoverRepair(sessionId, state, signal) {
    const messages = await readSessionMessages(sessionId, signal);
    const afterBaseline = messages.filter(
      (message) => message.id > state.baselineMessageId,
    );
    const userMessages = afterBaseline.filter(
      (message) => message.role === "user",
    );
    const matchingFeedback = userMessages.filter(
      (message) =>
        typeof message.content === "string" &&
        hashFeedback(message.content) === state.feedbackHash,
    );
    if (userMessages.length !== 1 || matchingFeedback.length !== 1) {
      throw new HermesClientError(
        "REPAIR_OUTCOME_UNKNOWN",
        "Hermes repair transcript is ambiguous; refusing to repeat the model turn",
      );
    }
    const feedbackMessage = matchingFeedback[0];
    if (
      afterBaseline.some(
        (message) =>
          message.id < feedbackMessage.id &&
          (message.role === "assistant" || message.role === "tool"),
      )
    ) {
      throw new HermesClientError(
        "REPAIR_OUTCOME_UNKNOWN",
        "Hermes repair transcript is ambiguous; refusing to repeat the model turn",
      );
    }
    const assistantOutputs = afterBaseline.filter(
      (message) =>
        message.id > feedbackMessage.id &&
        isProvableTerminalAssistantOutput(message),
    );
    const output = assistantOutputs[0];
    const trailingTurnMessages = output
      ? afterBaseline.filter(
          (message) =>
            message.id > output.id &&
            (message.role === "assistant" || message.role === "tool"),
        )
      : [];
    if (assistantOutputs.length !== 1 || trailingTurnMessages.length !== 0) {
      throw new HermesClientError(
        "REPAIR_OUTCOME_UNKNOWN",
        "Hermes repair has no uniquely recoverable assistant output; refusing to repeat the model turn",
      );
    }
    return output.content;
  }

  async function waitForReservedStart(sessionId, signal) {
    const deadline = Date.now() + requestTimeoutMs;
    for (;;) {
      if (signal?.aborted) {
        throw new HermesClientError("RUN_CANCELLED", "Hermes run cancelled");
      }
      await sleep(Math.min(Math.max(1, pollMs), 250), signal);
      const state = await runStateStore.get(sessionId);
      assertValidRunState(state);
      if (state?.phase !== "starting") return state;
      if (Date.now() >= deadline) {
        throw new HermesClientError(
          "RUN_START_UNKNOWN",
          "Another Runner reserved this Hermes start, but its outcome is still unknown",
        );
      }
    }
  }

  return {
    /** Run one generation to completion and return the model output. */
    async generate({ instructions, input, sessionId, operation, signal }) {
      if (
        typeof sessionId !== "string" ||
        !SESSION_ID_RE.test(sessionId) ||
        typeof instructions !== "string" ||
        instructions.length === 0 ||
        typeof input !== "string" ||
        input.length === 0
      ) {
        throw new HermesClientError(
          "RUN_REQUEST_INVALID",
          "Hermes generation request is invalid",
        );
      }
      let previousState = await runStateStore.get(sessionId);
      assertValidRunState(previousState);
      if (operation !== undefined) assertValidOperation(operation);
      let activeOperation = operation;
      if (previousState && previousState.phase !== "idle") {
        if (previousState.operation && !operation) {
          throw new HermesClientError(
            "RUN_OPERATION_MISMATCH",
            "A recoverable Hermes run is bound to an Agent operation",
          );
        }
        if (!previousState.operation && operation) {
          throw new HermesClientError(
            "RUN_OPERATION_MISMATCH",
            "Legacy Hermes state cannot be assigned to a new Agent operation safely",
          );
        }
        if (
          previousState.operation &&
          operation &&
          !sameOperationWork(previousState.operation, operation)
        ) {
          throw new HermesClientError(
            "RUN_OPERATION_MISMATCH",
            "Hermes recovery metadata does not match the issued prompt",
          );
        }
        activeOperation = operation ?? previousState.operation;
        if (
          previousState.operation &&
          operation &&
          previousState.operation.attemptId !== operation.attemptId
        ) {
          // A lease may be reissued with a new attempt id. Rebinding is safe
          // only because the TailoringRun id, target and prompt hash are exact.
          const reboundState = {
            ...previousState,
            operation,
          };
          const rebound = await compareAndSetRunState(
            sessionId,
            previousState,
            reboundState,
          );
          if (rebound) {
            previousState = reboundState;
          } else {
            const concurrentState = await runStateStore.get(sessionId);
            assertValidRunState(concurrentState);
            if (
              !concurrentState?.operation ||
              !sameOperationWork(concurrentState.operation, operation)
            ) {
              throw new HermesClientError(
                "RUN_OPERATION_MISMATCH",
                "Hermes recovery metadata changed before lease rebinding",
              );
            }
            previousState = concurrentState;
          }
        }
      }
      if (previousState?.phase === "starting") {
        if (hasStartRecoveryMetadata(previousState)) {
          try {
            return await recoverStartedRun(
              sessionId,
              previousState,
              instructions,
              input,
              signal,
            );
          } catch (error) {
            if (
              !(error instanceof HermesClientError) ||
              error.code !== "RUN_START_UNKNOWN"
            ) {
              throw error;
            }
          }
        }
        let concurrentState;
        try {
          concurrentState = await waitForReservedStart(sessionId, signal);
        } catch (error) {
          if (
            !(error instanceof HermesClientError) ||
            error.code !== "RUN_START_UNKNOWN"
          ) {
            throw error;
          }
          const latestState = await runStateStore.get(sessionId);
          assertValidRunState(latestState);
          if (
            latestState?.phase === "starting" &&
            hasStartRecoveryMetadata(latestState)
          ) {
            return recoverStartedRun(
              sessionId,
              latestState,
              instructions,
              input,
              signal,
            );
          }
          throw error;
        }
        if (
          concurrentState?.operation &&
          (!activeOperation ||
            !sameOperationWork(concurrentState.operation, activeOperation))
        ) {
          throw new HermesClientError(
            "RUN_OPERATION_MISMATCH",
            "A reserved Hermes start belongs to another Agent operation",
          );
        }
        previousState = concurrentState;
        activeOperation = activeOperation ?? concurrentState?.operation;
      }
      const repairUsed = previousState?.repairUsed === true;
      let runId;

      if (
        previousState &&
        typeof previousState.requestHash === "string" &&
        typeof previousState.inputHash === "string"
      ) {
        assertSameReservedRequest(previousState, instructions, input);
      }
      if (previousState?.phase === "repairing") {
        return recoverRepair(sessionId, previousState, signal);
      }
      if (previousState?.phase === "completed" && !("runId" in previousState)) {
        return recoverStartedRun(
          sessionId,
          previousState,
          instructions,
          input,
          signal,
        );
      }
      if (
        (previousState?.phase === "running" ||
          previousState?.phase === "completed") &&
        typeof previousState.runId === "string" &&
        RUN_ID_RE.test(previousState.runId)
      ) {
        runId = previousState.runId;
      } else {
        if (signal?.aborted) {
          throw new HermesClientError("RUN_CANCELLED", "Hermes run cancelled");
        }
        const baselineMessages = await readSessionMessages(sessionId, signal, {
          allowMissing: true,
          allowEmpty: true,
          invalidCode: "HERMES_PROTOCOL_ERROR",
        });
        const startingState = withOperation(
          {
            phase: "starting",
            repairUsed,
            baselineMessageId: baselineMessages.at(-1)?.id ?? 0,
            requestHash: hashRequest(instructions, input),
            inputHash: hashText(input),
          },
          activeOperation,
        );
        const reserved = await compareAndSetRunState(
          sessionId,
          previousState,
          startingState,
        );
        if (!reserved) {
          let concurrentState;
          try {
            concurrentState = await waitForReservedStart(sessionId, signal);
          } catch (error) {
            if (
              !(error instanceof HermesClientError) ||
              error.code !== "RUN_START_UNKNOWN"
            ) {
              throw error;
            }
            const latestState = await runStateStore.get(sessionId);
            assertValidRunState(latestState);
            if (
              latestState?.phase === "starting" &&
              hasStartRecoveryMetadata(latestState)
            ) {
              return recoverStartedRun(
                sessionId,
                latestState,
                instructions,
                input,
                signal,
              );
            }
            throw error;
          }
          if (
            concurrentState?.operation &&
            (!activeOperation ||
              !sameOperationWork(concurrentState.operation, activeOperation))
          ) {
            throw new HermesClientError(
              "RUN_OPERATION_MISMATCH",
              "A concurrent Hermes start belongs to another Agent operation",
            );
          }
          if (
            (concurrentState?.phase === "running" ||
              concurrentState?.phase === "completed") &&
            typeof concurrentState.runId === "string" &&
            RUN_ID_RE.test(concurrentState.runId)
          ) {
            runId = concurrentState.runId;
            previousState = concurrentState;
          } else if (concurrentState?.phase === "repairing") {
            return recoverRepair(sessionId, concurrentState, signal);
          } else if (
            concurrentState?.phase === "completed" &&
            !("runId" in concurrentState)
          ) {
            return recoverStartedRun(
              sessionId,
              concurrentState,
              instructions,
              input,
              signal,
            );
          } else {
            throw new HermesClientError(
              "RUN_START_UNKNOWN",
              "A concurrent Hermes start changed state without a recoverable run id",
            );
          }
        }
        if (!runId) {
          let started;
          try {
            started = await request("/v1/runs", {
              method: "POST",
              body: JSON.stringify({
                instructions,
                input,
                session_id: sessionId,
              }),
              signal,
            });
          } catch (error) {
            if (isDefinitiveStartRejection(error)) {
              await clearRunState(sessionId, repairUsed, startingState);
              throw error;
            }
            try {
              return await recoverStartedRun(
                sessionId,
                startingState,
                instructions,
                input,
                signal,
              );
            } catch (recoveryError) {
              if (
                !(recoveryError instanceof HermesClientError) ||
                recoveryError.code !== "RUN_START_UNKNOWN"
              ) {
                throw recoveryError;
              }
            }
            throw new HermesClientError(
              "RUN_START_UNKNOWN",
              "Hermes run start outcome is unknown; refusing to retry automatically",
              { cause: error },
            );
          }
          if (
            !started ||
            started.status !== "started" ||
            typeof started.run_id !== "string" ||
            !RUN_ID_RE.test(started.run_id)
          ) {
            try {
              return await recoverStartedRun(
                sessionId,
                startingState,
                instructions,
                input,
                signal,
              );
            } catch (recoveryError) {
              if (
                !(recoveryError instanceof HermesClientError) ||
                recoveryError.code !== "RUN_START_UNKNOWN"
              ) {
                throw recoveryError;
              }
            }
            throw new HermesClientError(
              "RUN_START_UNKNOWN",
              "Hermes start response is invalid; refusing to retry automatically",
            );
          }
          runId = started.run_id;
          const runningState = withOperation(
            {
              phase: "running",
              runId,
              repairUsed,
            },
            activeOperation,
          );
          const recorded = await compareAndSetRunState(
            sessionId,
            startingState,
            runningState,
          );
          if (!recorded) {
            throw new HermesClientError(
              "RUN_STATE_CONFLICT",
              "Hermes started, but its durable reservation changed unexpectedly",
            );
          }
          previousState = runningState;
        }
      }

      async function stopKnownRun() {
        try {
          const stopped = await request(`/v1/runs/${runId}/stop`, {
            method: "POST",
          });
          if (
            !stopped ||
            stopped.run_id !== runId ||
            stopped.status !== "stopping"
          ) {
            throw new HermesClientError(
              "HERMES_PROTOCOL_ERROR",
              "Hermes stop response is invalid",
            );
          }
          // "stopping" only acknowledges the interrupt request. Hermes still
          // owns a live run until a later status poll confirms a terminal
          // state, so retain the opaque id for restart-safe reconciliation.
          return true;
        } catch {
          // Preserve the run id: an unconfirmed stop may still be executing,
          // so the next Runner must resume/poll rather than start a duplicate.
          return false;
        }
      }

      async function cancelKnownRun() {
        await stopKnownRun();
        throw new HermesClientError("RUN_CANCELLED", "Hermes run cancelled");
      }

      const deadline = Date.now() + timeoutMs;
      for (;;) {
        if (signal?.aborted) await cancelKnownRun();
        if (Date.now() > deadline) {
          await stopKnownRun();
          throw new HermesClientError(
            "RUN_OUTCOME_UNKNOWN",
            `Hermes run timed out after ${timeoutMs}ms; its durable state was preserved`,
          );
        }
        await sleep(pollMs, signal);
        if (signal?.aborted) await cancelKnownRun();

        let run;
        try {
          run = await request(`/v1/runs/${runId}`, { signal });
        } catch (error) {
          if (signal?.aborted) await cancelKnownRun();
          throw new HermesClientError(
            "RUN_OUTCOME_UNKNOWN",
            "Hermes run status is temporarily unknown; its durable state was preserved",
            { cause: error },
          );
        }
        if (signal?.aborted) await cancelKnownRun();
        run = readRunSnapshot(run, runId);
        if (run.status === "completed") {
          if (typeof run.output !== "string" || run.output.length === 0) {
            throw new Error("Hermes completed without output");
          }
          // Keep the opaque run id until Joblit confirms the corresponding
          // import. A crash in that gap can then poll the same terminal run and
          // replay the idempotent receipt instead of generating twice.
          const completedState = withOperation(
            {
              phase: "completed",
              runId,
              repairUsed,
            },
            activeOperation,
          );
          const recorded = await compareAndSetRunState(
            sessionId,
            previousState,
            completedState,
          );
          if (!recorded) {
            const concurrentState = await runStateStore.get(sessionId);
            assertValidRunState(concurrentState);
            if (!isDeepStrictEqual(concurrentState, completedState)) {
              throw new HermesClientError(
                "RUN_STATE_CONFLICT",
                "Hermes completed, but its durable state changed unexpectedly",
              );
            }
          }
          previousState = completedState;
          return run.output;
        }
        if (run.status === "failed" || run.status === "cancelled") {
          await clearRunState(sessionId, repairUsed, previousState);
          throw new HermesClientError(
            run.status === "cancelled" ? "RUN_CANCELLED" : "RUN_FAILED",
            typeof run.error === "string" && run.error
              ? run.error
              : `Hermes run ${run.status}`,
          );
        }
      }
    },

    /**
     * Ask Hermes for one schema repair in the exact session that produced the
     * rejected output. The allowance is reserved before the network call so an
     * uncertain response can never trigger a second model turn.
     */
    async repair({ sessionId, feedback, signal }) {
      if (
        typeof sessionId !== "string" ||
        !SESSION_ID_RE.test(sessionId) ||
        typeof feedback !== "string" ||
        feedback.length === 0 ||
        feedback.length > 1_200
      ) {
        throw new HermesClientError(
          "REPAIR_REQUEST_INVALID",
          "Hermes repair request is invalid",
        );
      }
      const state = await runStateStore.get(sessionId);
      assertValidRunState(state);
      const feedbackHash = hashFeedback(feedback);
      if (state?.phase === "repairing") {
        if (state.feedbackHash !== feedbackHash) {
          throw new HermesClientError(
            "REPAIR_LIMIT_REACHED",
            "Hermes repair is limited to one turn per session",
          );
        }
        return recoverRepair(sessionId, state, signal);
      }
      if (!state || state.phase !== "completed") {
        throw new HermesClientError(
          "REPAIR_NOT_AVAILABLE",
          "No completed Hermes run is available for repair",
        );
      }
      if (state.repairUsed === true) {
        throw new HermesClientError(
          "REPAIR_LIMIT_REACHED",
          "Hermes repair is limited to one turn per session",
        );
      }
      if (signal?.aborted) {
        throw new HermesClientError("RUN_CANCELLED", "Hermes repair cancelled");
      }
      const messages = await readSessionMessages(sessionId, signal);
      const baselineMessageId = messages.at(-1).id;
      const repairIdentity =
        typeof state.runId === "string"
          ? { runId: state.runId }
          : { requestHash: state.requestHash, inputHash: state.inputHash };
      const repairingState = withOperation(
        {
          phase: "repairing",
          ...repairIdentity,
          repairUsed: true,
          feedbackHash,
          baselineMessageId,
        },
        state.operation,
      );
      const reserved = await compareAndSetRunState(
        sessionId,
        state,
        repairingState,
      );
      if (!reserved) {
        const concurrentState = await runStateStore.get(sessionId);
        assertValidRunState(concurrentState);
        if (
          concurrentState?.phase === "repairing" &&
          concurrentState.feedbackHash === feedbackHash
        ) {
          return recoverRepair(sessionId, concurrentState, signal);
        }
        throw new HermesClientError(
          "RUN_STATE_CONFLICT",
          "Hermes repair state changed before the repair could be reserved",
        );
      }

      const repaired = await request(
        `/api/sessions/${encodeURIComponent(sessionId)}/chat`,
        {
          method: "POST",
          body: JSON.stringify({ message: feedback }),
          signal,
        },
        repairTimeoutMs,
      );
      const isCurrentResponse =
        repaired !== null &&
        typeof repaired === "object" &&
        ("object" in repaired ||
          "session_id" in repaired ||
          "message" in repaired);
      const message = isCurrentResponse ? repaired.message : repaired;
      if (
        !message ||
        message.role !== "assistant" ||
        typeof message.content !== "string" ||
        message.content.length === 0 ||
        message.content.length > MAX_MODEL_OUTPUT_CHARS ||
        (isCurrentResponse &&
          (repaired.object !== "hermes.session.chat.completion" ||
            repaired.session_id !== sessionId ||
            !repaired.message ||
            typeof repaired.message !== "object" ||
            "role" in repaired ||
            "content" in repaired))
      ) {
        throw new HermesClientError(
          "REPAIR_RESPONSE_INVALID",
          "Hermes repair response is invalid",
        );
      }
      return message.content;
    },

    /**
     * Retire local work only after Joblit proves its operation is already
     * accepted or terminal. A known live run is stopped and observed terminal
     * before its private id is cleared; an ambiguous start is cleared only
     * when the transcript independently proves its terminal assistant turn.
     */
    async reconcileObsolete({ sessionId, signal }) {
      if (typeof sessionId !== "string" || !SESSION_ID_RE.test(sessionId)) {
        throw new HermesClientError(
          "RUN_REQUEST_INVALID",
          "Hermes session id is invalid",
        );
      }
      const state = await runStateStore.get(sessionId);
      assertValidRunState(state);
      if (!state || state.phase === "idle") return { cleared: true };

      if (state.phase === "completed" || state.phase === "repairing") {
        await clearRunState(sessionId, state.repairUsed, state);
        return { cleared: true };
      }

      if (state.phase === "starting") {
        await proveStartedRunTerminal(sessionId, state, signal);
        await clearRunState(sessionId, state.repairUsed, state);
        return { cleared: true };
      }

      if (state.phase !== "running") {
        throw new HermesClientError(
          "RUN_STATE_CONFLICT",
          "Hermes recovery state cannot be reconciled",
        );
      }

      const runId = state.runId;
      let run = readRunSnapshot(
        await request(`/v1/runs/${runId}`, { signal }),
        runId,
      );
      const terminal = new Set(["completed", "failed", "cancelled"]);
      if (!terminal.has(run.status) && run.status !== "stopping") {
        const stopped = await request(`/v1/runs/${runId}/stop`, {
          method: "POST",
          signal,
        });
        if (
          !stopped ||
          stopped.run_id !== runId ||
          stopped.status !== "stopping"
        ) {
          throw new HermesClientError(
            "HERMES_PROTOCOL_ERROR",
            "Hermes stop response is invalid",
          );
        }
      }

      const deadline =
        Date.now() + Math.min(timeoutMs, MAX_RECONCILIATION_WAIT_MS);
      while (!terminal.has(run.status)) {
        if (signal?.aborted) {
          throw new HermesClientError(
            "RUN_CANCELLED",
            "Hermes reconciliation cancelled",
          );
        }
        if (Date.now() >= deadline) {
          throw new HermesClientError(
            "RUN_RECONCILIATION_DEFERRED",
            "Hermes run did not become terminal before the reconciliation deadline",
          );
        }
        await sleep(Math.max(1, pollMs), signal);
        run = readRunSnapshot(
          await request(`/v1/runs/${runId}`, { signal }),
          runId,
        );
      }

      await clearRunState(sessionId, state.repairUsed, state);
      return { cleared: true };
    },

    /**
     * Forget a terminal Hermes run only after Joblit has durably accepted the
     * corresponding result. Until this acknowledgement, generate() recovers
     * the same run id and replays its terminal output.
     */
    async acknowledge({ sessionId }) {
      if (typeof sessionId !== "string" || !SESSION_ID_RE.test(sessionId)) {
        throw new HermesClientError(
          "RUN_REQUEST_INVALID",
          "Hermes session id is invalid",
        );
      }
      const state = await runStateStore.get(sessionId);
      assertValidRunState(state);
      if (
        !state ||
        (state.phase !== "completed" && state.phase !== "repairing")
      ) {
        throw new HermesClientError(
          "RUN_ACKNOWLEDGEMENT_INVALID",
          "No completed Hermes run is awaiting acknowledgement",
        );
      }
      await clearRunState(sessionId, state.repairUsed, state);
    },

    /** List only non-secret terminal operation identities safe to reconcile. */
    async recoverableOperations() {
      if (typeof runStateStore.list !== "function") return [];
      const entries = await runStateStore.list();
      if (!Array.isArray(entries)) {
        throw new HermesClientError(
          "RUN_STATE_INVALID",
          "Persisted Hermes run state list is invalid",
        );
      }
      const recoverable = [];
      for (const entry of entries) {
        if (
          !entry ||
          typeof entry !== "object" ||
          typeof entry.sessionId !== "string" ||
          !SESSION_ID_RE.test(entry.sessionId)
        ) {
          throw new HermesClientError(
            "RUN_STATE_INVALID",
            "Persisted Hermes run state list is invalid",
          );
        }
        assertValidRunState(entry.state);
        if (entry.state.phase !== "idle" && entry.state.operation) {
          recoverable.push({
            sessionId: entry.sessionId,
            phase: entry.state.phase,
            operation: structuredClone(entry.state.operation),
          });
        }
      }
      return recoverable;
    },


    /** Forget a terminal result only after Joblit proves it cannot be used. */
    async discard({ sessionId }) {
      if (typeof sessionId !== "string" || !SESSION_ID_RE.test(sessionId)) {
        throw new HermesClientError(
          "RUN_REQUEST_INVALID",
          "Hermes session id is invalid",
        );
      }
      const state = await runStateStore.get(sessionId);
      assertValidRunState(state);
      if (
        !state ||
        (state.phase !== "completed" && state.phase !== "repairing")
      ) {
        throw new HermesClientError(
          "RUN_DISCARD_INVALID",
          "No terminal Hermes result is available to discard",
        );
      }
      await clearRunState(sessionId, state.repairUsed, state);
    },
  };
}
