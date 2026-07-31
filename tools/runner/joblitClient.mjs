/**
 * Joblit protocol client for the Runner.
 *
 * Authenticates with a versioned AgentCredential bearer over the batch
 * protocol routes; see AGENTS.md. The server's error envelope
 * `{ error: { code, message } }` is surfaced as the thrown message so a
 * failure reads as what the server said, not as a status code.
 */

export class JoblitClientError extends Error {
  constructor(code, message, status, { cause } = {}) {
    super(message);
    this.name = "JoblitClientError";
    this.code = code;
    this.status = status;
    if (cause !== undefined) this.cause = cause;
  }
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const AGENT_TOKEN_RE = /^jfagent_v1_[0-9a-f]{64}$/;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

async function readError(response) {
  const body = await response.json().catch(() => null);
  const error =
    body && typeof body === "object" ? body.error : undefined;
  if (error && typeof error === "object" && typeof error.message === "string") {
    return {
      code:
        typeof error.code === "string" && error.code.length > 0
          ? error.code
          : "JOBLIT_HTTP_ERROR",
      message: error.message,
    };
  }
  return {
    code: "JOBLIT_HTTP_ERROR",
    message: `Joblit HTTP ${response.status}`,
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
  if (
    !Number.isSafeInteger(requestTimeoutMs) ||
    requestTimeoutMs <= 0
  ) {
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
    const upstreamSignal = init.signal;
    const timeoutSignal = AbortSignal.timeout(requestTimeoutMs);
    const signal = upstreamSignal
      ? AbortSignal.any([upstreamSignal, timeoutSignal])
      : timeoutSignal;
    try {
      const response = await fetchImpl(`${base}${path}`, {
        ...init,
        signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...(init.headers ?? {}),
        },
      });
      if (!response.ok) {
        const error = await readError(response);
        throw new JoblitClientError(error.code, error.message, response.status);
      }
      return parseJson ? await response.json() : response;
    } catch (error) {
      if (upstreamSignal?.aborted) {
        throw new JoblitClientError(
          "JOBLIT_REQUEST_ABORTED",
          "Joblit request cancelled",
          undefined,
          { cause: error },
        );
      }
      if (timeoutSignal.aborted) {
        throw new JoblitClientError(
          "JOBLIT_REQUEST_TIMEOUT",
          `Joblit request timed out after ${requestTimeoutMs}ms`,
          undefined,
          { cause: error },
        );
      }
      if (error instanceof JoblitClientError) throw error;
      throw new JoblitClientError(
        "JOBLIT_TRANSPORT_ERROR",
        "Joblit request outcome could not be confirmed",
        undefined,
        { cause: error },
      );
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
          body: JSON.stringify({ maxSteps: 1, completedTasks }),
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
      return requestJson(
        `/api/tailoring-runs/${encodeURIComponent(runId)}`,
        { signal },
      );
    },

    /**
     * Import a generated target. FINAL delivery returns the rendered PDF as
     * the response body; the Runner only needs the settlement, so any 2xx is
     * success and the body is discarded.
     */
    async importGeneration(requestBody) {
      await request("/api/applications/manual-generate?finalize=true", {
        method: "POST",
        body: JSON.stringify(requestBody),
      });
      return { ok: true };
    },

    // ── Fit queue ──────────────────────────────────────────────────────────
    // The database is the queue; these lease, score and settle one batch of
    // coarse triage at a time.

    async nextFitBatch() {
      return requestJson("/api/jobs/fit/next-batch", { method: "POST" });
    },

    async fitPrompt(requestBody) {
      return requestJson("/api/jobs/fit/prompt", {
        method: "POST",
        body: JSON.stringify(requestBody),
      });
    },

    async importFitBatch(requestBody) {
      return requestJson("/api/jobs/fit/batch-import", {
        method: "POST",
        body: JSON.stringify(requestBody),
      });
    },

    async fitSettlement(issueKey) {
      return requestJson("/api/jobs/fit/settlement-status", {
        method: "POST",
        body: JSON.stringify({ issueKey }),
      });
    },

    async markFitFailed(requestBody) {
      return requestJson("/api/jobs/fit/mark-failed", {
        method: "POST",
        body: JSON.stringify(requestBody),
      });
    },

    async releaseFitBatch(requestBody) {
      return requestJson("/api/jobs/fit/release-batch", {
        method: "POST",
        body: JSON.stringify(requestBody),
      });
    },
  };
}
