/**
 * Joblit protocol client for the Runner.
 *
 * Authenticates with an agent token (ExtensionToken bearer) over the batch
 * protocol routes; see AGENTS.md. The server's error envelope
 * `{ error: { code, message } }` is surfaced as the thrown message so a
 * failure reads as what the server said, not as a status code.
 */

async function readErrorMessage(response) {
  const body = await response.json().catch(() => null);
  const error =
    body && typeof body === "object" ? body.error : undefined;
  if (error && typeof error === "object" && typeof error.message === "string") {
    const code = typeof error.code === "string" ? `${error.code}: ` : "";
    return `${code}${error.message}`;
  }
  return `Joblit HTTP ${response.status}`;
}

export function createJoblitClient({ baseUrl, token, fetchImpl = fetch }) {
  if (!baseUrl) throw new Error("JOBLIT_URL is required");
  if (!token) throw new Error("JOBLIT_TOKEN is required");
  const base = new URL(baseUrl).origin;

  async function request(path, init = {}) {
    const response = await fetchImpl(`${base}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(init.headers ?? {}),
      },
    });
    if (!response.ok) {
      throw new Error(await readErrorMessage(response));
    }
    return response;
  }

  async function requestJson(path, init = {}) {
    const response = await request(path, init);
    return response.json();
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
  };
}
