/**
 * Minimal Hermes gateway client for the Runner.
 *
 * Ported from the extension's `hermesApi.ts` protocol: POST /v1/runs with
 * `{instructions, input, session_id}` and a Bearer key, then poll
 * GET /v1/runs/{id} until `completed` or `failed`.
 *
 * The gateway must be loopback. The key is a local credential; sending it
 * anywhere else would turn a configuration typo into credential
 * exfiltration, so the client refuses to construct at all.
 */

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const RUN_ID_RE = /^run_[0-9a-f]{32}$/;
const DEFAULT_TIMEOUT_MS = 240_000;
const DEFAULT_POLL_MS = 1_500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createHermesClient({
  baseUrl,
  apiKey,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  pollMs = DEFAULT_POLL_MS,
}) {
  const parsed = new URL(baseUrl);
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new Error(
      `Hermes gateway must be loopback; refusing ${parsed.hostname}. The API key never leaves this machine.`,
    );
  }
  if (!apiKey) throw new Error("HERMES_KEY is required");
  const base = `${parsed.origin}`;

  async function request(path, init = {}) {
    const response = await fetchImpl(`${base}${path}`, {
      ...init,
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
      throw new Error(message);
    }
    return body;
  }

  return {
    /** Run one generation to completion and return the model output. */
    async generate({ instructions, input, sessionId }) {
      const started = await request("/v1/runs", {
        method: "POST",
        body: JSON.stringify({
          instructions,
          input,
          session_id: sessionId,
        }),
      });
      if (
        !started ||
        started.status !== "started" ||
        typeof started.run_id !== "string" ||
        !RUN_ID_RE.test(started.run_id)
      ) {
        throw new Error("Hermes start response is invalid");
      }

      const deadline = Date.now() + timeoutMs;
      for (;;) {
        if (Date.now() > deadline) {
          await request(`/v1/runs/${started.run_id}/stop`, {
            method: "POST",
          }).catch(() => undefined);
          throw new Error(`Hermes run timed out after ${timeoutMs}ms`);
        }
        await sleep(pollMs);

        const run = await request(`/v1/runs/${started.run_id}`);
        if (!run || run.object !== "hermes.run") {
          throw new Error("Hermes run response is invalid");
        }
        if (run.status === "completed") {
          if (typeof run.output !== "string" || run.output.length === 0) {
            throw new Error("Hermes completed without output");
          }
          return run.output;
        }
        if (run.status === "failed" || run.status === "cancelled") {
          throw new Error(
            typeof run.error === "string" && run.error
              ? run.error
              : `Hermes run ${run.status}`,
          );
        }
      }
    },
  };
}
