/**
 * Joblit protocol client for the Runner.
 *
 * Authenticates with a versioned AgentCredential bearer over the batch
 * protocol routes; see AGENTS.md. The server's error envelope
 * `{ error: { code, message } }` is surfaced as the thrown message so a
 * failure reads as what the server said, not as a status code.
 */

import { createRequestDeadline } from "./requestDeadline.mjs";

export class JoblitClientError extends Error {
  constructor(
    code,
    message,
    status,
    { cause, phase, requestId, elapsedMs } = {},
  ) {
    super(message);
    this.name = "JoblitClientError";
    this.code = code;
    this.status = status;
    if (phase !== undefined) this.phase = phase;
    if (requestId !== undefined) this.requestId = requestId;
    if (elapsedMs !== undefined) this.elapsedMs = elapsedMs;
    if (cause !== undefined) this.cause = cause;
  }
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const AGENT_TOKEN_RE = /^jfagent_v1_[0-9a-f]{64}$/;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
/**
 * Importing a generation is not a normal API call: the route validates the
 * model output, compiles LaTeX through an external renderer (allowed 20s on
 * its own), parses the resulting PDF, uploads it, and commits a transaction.
 * The default budget was smaller than that one render step, so a slow render
 * timed out the client while the server went on to succeed — reported as an
 * unknown settlement, then replayed into the same wall. This budget is for
 * the whole chain, with room for the renderer to be cold.
 */
const PUBLICATION_TIMEOUT_MS = 120_000;

async function readError(response) {
  const body = await response.json().catch(() => null);
  const error = body && typeof body === "object" ? body.error : undefined;
  if (error && typeof error === "object" && typeof error.message === "string") {
    return {
      code:
        typeof error.code === "string" && error.code.length > 0
          ? error.code
          : "JOBLIT_HTTP_ERROR",
      message: error.message,
      requestId:
        body && typeof body.requestId === "string" ? body.requestId : undefined,
    };
  }
  return {
    code: "JOBLIT_HTTP_ERROR",
    message: `Joblit HTTP ${response.status}`,
    requestId:
      body && typeof body === "object" && typeof body.requestId === "string"
        ? body.requestId
        : undefined,
  };
}

export function createJoblitClient({
  baseUrl,
  token,
  fetchImpl = fetch,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
}) {
  if (!baseUrl) throw new Error("JOBLIT_URL is required");
  if (!token) throw new Error("JOBLIT_TOKEN is required");
  if (!AGENT_TOKEN_RE.test(token)) {
    throw new Error(
      "JOBLIT_TOKEN must be a version 1 AgentCredential (jfagent_v1_...)",
    );
  }
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs <= 0) {
    throw new Error("Joblit request timeout must be a positive integer");
  }
  const parsed = new URL(baseUrl);
  if (parsed.username || parsed.password) {
    throw new Error("JOBLIT_URL must not contain embedded credentials");
  }
  if (
    parsed.protocol !== "https:" &&
    !(parsed.protocol === "http:" && LOOPBACK_HOSTS.has(parsed.hostname))
  ) {
    throw new Error(
      "JOBLIT_URL must use HTTPS (plain HTTP is allowed only on loopback)",
    );
  }
  const base = parsed.origin;

  async function execute(path, init = {}, parseJson = false) {
    const { timeoutMs: callTimeoutMs, phase, ...requestInit } = init;
    const startedAt = Date.now();
    const budgetMs = callTimeoutMs ?? requestTimeoutMs;
    const upstreamSignal = requestInit.signal;
    const deadline = createRequestDeadline(budgetMs);
    const signal = upstreamSignal
      ? AbortSignal.any([upstreamSignal, deadline.signal])
      : deadline.signal;
    try {
      const response = await fetchImpl(`${base}${path}`, {
        ...requestInit,
        signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...(init.headers ?? {}),
        },
      });
      if (!response.ok) {
        const error = await readError(response);
        throw new JoblitClientError(error.code, error.message, response.status, {
          phase,
          requestId: error.requestId,
          elapsedMs: Date.now() - startedAt,
        });
      }
      return parseJson ? await response.json() : response;
    } catch (error) {
      if (upstreamSignal?.aborted) {
        throw new JoblitClientError(
          "JOBLIT_REQUEST_ABORTED",
          "Joblit request cancelled",
          undefined,
          { cause: error, phase, elapsedMs: Date.now() - startedAt },
        );
      }
      if (deadline.expired()) {
        throw new JoblitClientError(
          "JOBLIT_REQUEST_TIMEOUT",
          `Joblit request timed out after ${budgetMs}ms`,
          undefined,
          { cause: error, phase, elapsedMs: Date.now() - startedAt },
        );
      }
      if (error instanceof JoblitClientError) throw error;
      throw new JoblitClientError(
        "JOBLIT_TRANSPORT_ERROR",
        "Joblit request outcome could not be confirmed",
        undefined,
        { cause: error, phase, elapsedMs: Date.now() - startedAt },
      );
    } finally {
      deadline.dispose();
    }
  }

  async function request(path, init = {}) {
    return execute(path, init, false);
  }

  async function requestJson(path, init = {}) {
    return execute(path, init, true);
  }

  return {
    async activeBatch() {
      return requestJson("/api/application-batches/active");
    },

    async runOnce(batchId, { completedTasks }) {
      return requestJson(
        `/api/application-batches/${encodeURIComponent(batchId)}/run-once`,
        {
          method: "POST",
          body: JSON.stringify({
            maxSteps: 1,
            completedTasks,
            supportedProtocolVersions: [2, 1],
          }),
        },
      );
    },

    async prompt(requestBody) {
      return requestJson("/api/applications/prompt", {
        method: "POST",
        body: JSON.stringify(requestBody),
      });
    },

    async tailoringRunStatus(runId, { signal } = {}) {
      return requestJson(`/api/tailoring-runs/${encodeURIComponent(runId)}`, {
        signal,
      });
    },

    /**
     * Import a generated target. FINAL delivery returns the rendered PDF as
     * the response body; the Runner only needs the settlement, so any 2xx is
     * success and the body is discarded.
     */
    async importGeneration(requestBody, { finalize = true } = {}) {
      const path = `/api/applications/manual-generate?finalize=${String(finalize)}`;
      const init = {
        method: "POST",
        body: JSON.stringify(requestBody),
        phase: "import",
      };
      if (!finalize) return requestJson(path, init);
      const response = await request(path, {
        ...init,
        timeoutMs: PUBLICATION_TIMEOUT_MS,
      });
      // Drain the discarded PDF so Undici can reuse this connection for the
      // immediately-following Cover request. Once the server returned 2xx the
      // import is authoritative; a late body-stream failure must not reverse
      // that settlement into an ambiguous import.
      try {
        await response.arrayBuffer();
      } catch {
        // Best-effort resource cleanup only. The 2xx settlement still wins.
      }
      return { ok: true };
    },

    async publishGeneration({
      applicationId,
      expectedHash,
      runId,
      attemptId,
      target,
      batchAttemptId,
    }) {
      return requestJson(
        `/api/applications/${encodeURIComponent(applicationId)}/finalize?target=${encodeURIComponent(target)}`,
        {
          method: "POST",
          body: JSON.stringify({
            expectedHash,
            tailoringRun: { id: runId, attemptId },
            batchAttemptId,
          }),
          timeoutMs: PUBLICATION_TIMEOUT_MS,
          phase: "publication",
        },
      );
    },

    async releaseTask(batchId, releasedTask) {
      return requestJson(
        `/api/application-batches/${encodeURIComponent(batchId)}/run-once`,
        {
          method: "POST",
          body: JSON.stringify({
            maxSteps: 0,
            completedTasks: [],
            releasedTasks: [releasedTask],
            supportedProtocolVersions: [2, 1],
          }),
          phase: "release",
        },
      );
    },
  };
}
