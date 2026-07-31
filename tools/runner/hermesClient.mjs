import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

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
const FEEDBACK_HASH_RE = /^[0-9a-f]{64}$/;
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
  const phaseOwnsRunId =
    state?.phase === "running" ||
    state?.phase === "completed" ||
    state?.phase === "repairing";
  const validRunId =
    isObject &&
    (phaseOwnsRunId
      ? typeof state.runId === "string" && RUN_ID_RE.test(state.runId)
      : !("runId" in state));
  const validRepairMetadata =
    isObject &&
    (state.phase === "repairing"
      ? state.repairUsed === true &&
        typeof state.feedbackHash === "string" &&
        FEEDBACK_HASH_RE.test(state.feedbackHash) &&
        Number.isSafeInteger(state.baselineMessageId) &&
        state.baselineMessageId > 0
      : !("feedbackHash" in state) && !("baselineMessageId" in state));
  const allowedKeys = new Set(["phase", "repairUsed"]);
  if (
    state?.phase === "running" ||
    state?.phase === "completed" ||
    state?.phase === "repairing"
  ) {
    allowedKeys.add("runId");
  }
  if (state?.phase === "repairing") {
    allowedKeys.add("feedbackHash");
    allowedKeys.add("baselineMessageId");
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
    !validRunId ||
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
      return runStateStore.compareAndSet(
        sessionId,
        expectedValue,
        nextValue,
      );
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

  async function request(path, init = {}, timeoutOverrideMs = requestTimeoutMs) {
    const upstreamSignal = init.signal;
    const timeoutSignal = AbortSignal.timeout(timeoutOverrideMs);
    const signal = upstreamSignal
      ? AbortSignal.any([upstreamSignal, timeoutSignal])
      : timeoutSignal;
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
        const message =
          body && typeof body === "object" && typeof body.error === "string"
            ? body.error
            : `Hermes HTTP ${response.status}`;
        throw new HermesClientError("HERMES_HTTP_ERROR", message, {
          status: response.status,
        });
      }
      return body;
    } catch (error) {
      if (upstreamSignal?.aborted) throw error;
      if (timeoutSignal.aborted) {
        throw new HermesClientError(
          "HERMES_REQUEST_TIMEOUT",
          `Hermes request timed out after ${timeoutOverrideMs}ms`,
          { cause: error },
        );
      }
      throw error;
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
    return createHash("sha256").update(feedback, "utf8").digest("hex");
  }

  async function readSessionMessages(sessionId, signal) {
    const transcript = await request(
      `/api/sessions/${encodeURIComponent(sessionId)}/messages`,
      { signal },
    );
    if (
      !transcript ||
      transcript.object !== "list" ||
      transcript.session_id !== sessionId ||
      !Array.isArray(transcript.data) ||
      transcript.data.length === 0
    ) {
      throw new HermesClientError(
        "REPAIR_TRANSCRIPT_INVALID",
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
          "REPAIR_TRANSCRIPT_INVALID",
          "Hermes session transcript response is invalid",
        );
      }
      previousId = message.id;
    }
    return transcript.data;
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
        message.role === "assistant" &&
        typeof message.content === "string" &&
        message.content.length > 0,
    );
    if (
      assistantOutputs.length !== 1 ||
      assistantOutputs[0].content.length > MAX_MODEL_OUTPUT_CHARS
    ) {
      throw new HermesClientError(
        "REPAIR_OUTCOME_UNKNOWN",
        "Hermes repair has no uniquely recoverable assistant output; refusing to repeat the model turn",
      );
    }
    return assistantOutputs[0].content;
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
      if (typeof sessionId !== "string" || !SESSION_ID_RE.test(sessionId)) {
        throw new HermesClientError(
          "RUN_REQUEST_INVALID",
          "Hermes session id is invalid",
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
        const concurrentState = await waitForReservedStart(sessionId, signal);
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

      if (previousState?.phase === "repairing") {
        return recoverRepair(sessionId, previousState, signal);
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
        const startingState = withOperation(
          { phase: "starting", repairUsed },
          activeOperation,
        );
        const reserved = await compareAndSetRunState(
          sessionId,
          previousState,
          startingState,
        );
        if (!reserved) {
          const concurrentState = await waitForReservedStart(
            sessionId,
            signal,
          );
          if (
            concurrentState?.operation &&
            (!activeOperation ||
              !sameOperationWork(
                concurrentState.operation,
                activeOperation,
              ))
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
            if (
              error instanceof HermesClientError &&
              error.code === "HERMES_HTTP_ERROR"
            ) {
              await clearRunState(sessionId, repairUsed, startingState);
              throw error;
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
          throw new Error(
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
      const repairingState = withOperation(
        {
          phase: "repairing",
          runId: state.runId,
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

    /**
     * List only completed Fit issue identities whose server receipt can be
     * checked after a crash. Prompts, model output and job data never leave
     * the in-memory Hermes response or enter this recovery list.
     */
    async recoverableFitIssues() {
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
        const match = /^joblit:fit:([a-f0-9]{64})$/.exec(entry.sessionId);
        if (
          match &&
          entry.state.phase === "completed" &&
          !entry.state.operation
        ) {
          recoverable.push({
            sessionId: entry.sessionId,
            issueKey: match[1],
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
