import { isHermesProfileName, normalizeHermesBase } from "@ext/shared/hermesBase";
import type { HermesProbeResult, HermesRun, HermesRunStatus } from "@ext/shared/hermesTypes";
import { MAX_MODEL_OUTPUT_CHARS } from "@ext/shared/hermesTypes";
import { HermesApiError } from "./apiErrors";

const REQUEST_TIMEOUT_MS = 15_000;
const PROBE_TIMEOUT_MS = 6_000;
const SESSION_CHAT_TIMEOUT_MS = 75_000;
const PROGRESS_PEEK_TIMEOUT_MS = 1_200;
const MAX_JSON_BYTES = 192_000;
const RUN_ID_RE = /^run_[0-9a-f]{32}$/;
const SESSION_ID_RE = /^joblit:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STOCK_RUN_STATUSES = new Set<HermesRunStatus>([
  "queued",
  "running",
  "waiting_for_approval",
  "stopping",
  "completed",
  "failed",
  "cancelled",
]);

interface HermesClientConfig {
  baseUrl: string;
  apiKey: string;
  profileName: string;
}

interface StartRunBody {
  input: string;
  instructions: string;
  session_id: string;
}

interface HermesApi {
  probe(): Promise<HermesProbeResult>;
  startRun(body: StartRunBody): Promise<{ runId: string }>;
  getRun(runId: string): Promise<HermesRun>;
  stopRun(runId: string): Promise<void>;
  /** One-turn repair on an existing run session; returns the assistant reply text. */
  sessionChat(sessionId: string, message: string): Promise<string>;
  /** Best-effort peek at generated output size for an in-flight run; null when unknown. */
  peekRunProgress(runId: string): Promise<number | null>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isEndpoint(value: unknown, method: "GET" | "POST", path: string): boolean {
  return isRecord(value) && value.method === method && value.path === path;
}

function validateApiKey(value: string): string {
  if (typeof value !== "string" || value.length < 20 || value.length > 512 || /[\s\u0000-\u001f]/.test(value)) {
    throw new HermesApiError("HERMES_SETTINGS_INVALID", "Invalid Hermes API key");
  }
  return value;
}

function validateProfileName(value: string): string {
  if (!isHermesProfileName(value)) {
    throw new HermesApiError("HERMES_SETTINGS_INVALID", "Invalid Hermes profile name");
  }
  return value;
}

function validateRunId(value: string): string {
  if (!RUN_ID_RE.test(value)) throw new HermesApiError("HERMES_PROTOCOL_ERROR", "Invalid Hermes run id");
  return value;
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    throw new HermesApiError("HERMES_PROTOCOL_ERROR", "Hermes returned non-JSON data");
  }
  const announced = Number(response.headers.get("content-length"));
  if (Number.isFinite(announced) && announced > MAX_JSON_BYTES) {
    throw new HermesApiError("HERMES_RESPONSE_TOO_LARGE", "Hermes response exceeds limit");
  }

  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_JSON_BYTES) {
      throw new HermesApiError("HERMES_RESPONSE_TOO_LARGE", "Hermes response exceeds limit");
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new HermesApiError("HERMES_PROTOCOL_ERROR", "Hermes returned invalid JSON");
    }
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_JSON_BYTES) {
        await reader.cancel();
        throw new HermesApiError("HERMES_RESPONSE_TOO_LARGE", "Hermes response exceeds limit");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new HermesApiError("HERMES_PROTOCOL_ERROR", "Hermes returned invalid JSON");
  }
}

function httpError(response: Response, missingRun: boolean): HermesApiError {
  if (response.status === 401) {
    return new HermesApiError("HERMES_AUTH_FAILED", "Hermes rejected API key", { status: response.status });
  }
  if (response.status === 403) {
    return new HermesApiError("HERMES_ORIGIN_FORBIDDEN", "Hermes blocked the extension origin", { status: response.status });
  }
  if (response.status === 404) {
    return missingRun
      ? new HermesApiError("HERMES_RUN_NOT_FOUND", "Hermes run not found", { status: 404, retryable: true })
      : new HermesApiError("HERMES_INCOMPATIBLE", "Required Hermes endpoint is unavailable", { status: 404 });
  }
  if (response.status === 429) {
    return new HermesApiError("HERMES_RATE_LIMITED", "Hermes rate limited request", { status: 429, retryable: true });
  }
  if (response.status >= 500) {
    return new HermesApiError("HERMES_UNREACHABLE", "Hermes server failed", { status: response.status, retryable: true });
  }
  return new HermesApiError("HERMES_PROTOCOL_ERROR", "Hermes rejected request", { status: response.status });
}

export function createHermesApi(input: HermesClientConfig): HermesApi {
  const baseUrl = normalizeHermesBase(input.baseUrl);
  const apiKey = validateApiKey(input.apiKey);
  const profileName = validateProfileName(input.profileName);

  async function request(
    path: "/health" | "/v1/capabilities" | "/v1/models" | "/v1/toolsets" | "/v1/runs" | string,
    init: RequestInit = {},
    timeoutMs = REQUEST_TIMEOUT_MS,
    ambiguousStart = false,
    missingRun = false,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        ...init,
        redirect: "error",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
          ...(init.body ? { "Content-Type": "application/json" } : {}),
        },
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "AbortError";
      throw new HermesApiError(
        "HERMES_UNREACHABLE",
        timedOut ? "Hermes request timed out" : "Hermes is unreachable",
        { retryable: true, ambiguousStart },
      );
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) throw httpError(response, missingRun);
    return readBoundedJson(response);
  }

  return {
    async probe() {
      const health = await request("/health", {}, PROBE_TIMEOUT_MS);
      if (!isRecord(health) || health.status !== "ok") {
        throw new HermesApiError("HERMES_INCOMPATIBLE", "Hermes health response is incompatible");
      }
      const [capabilities, models, toolsets] = await Promise.all([
        request("/v1/capabilities", {}, PROBE_TIMEOUT_MS),
        request("/v1/models", {}, PROBE_TIMEOUT_MS),
        request("/v1/toolsets", {}, PROBE_TIMEOUT_MS),
      ]);
      if (
        !isRecord(capabilities) ||
        capabilities.object !== "hermes.api_server.capabilities" ||
        capabilities.platform !== "hermes-agent" ||
        capabilities.model !== profileName ||
        !isRecord(capabilities.auth) ||
        capabilities.auth.type !== "bearer" ||
        capabilities.auth.required !== true ||
        !isRecord(capabilities.features) ||
        capabilities.features.run_submission !== true ||
        capabilities.features.run_status !== true ||
        capabilities.features.run_stop !== true ||
        !isRecord(capabilities.endpoints) ||
        !isEndpoint(capabilities.endpoints.runs, "POST", "/v1/runs") ||
        !isEndpoint(capabilities.endpoints.run_status, "GET", "/v1/runs/{run_id}") ||
        !isEndpoint(capabilities.endpoints.run_stop, "POST", "/v1/runs/{run_id}/stop") ||
        !isEndpoint(capabilities.endpoints.toolsets, "GET", "/v1/toolsets") ||
        !isEndpoint(capabilities.endpoints.models, "GET", "/v1/models") ||
        !isEndpoint(capabilities.endpoints.health, "GET", "/health")
      ) {
        throw new HermesApiError("HERMES_INCOMPATIBLE", "Required Hermes Runs API is unavailable");
      }
      if (
        !isRecord(models) ||
        models.object !== "list" ||
        !Array.isArray(models.data) ||
        !models.data.every((model) =>
          isRecord(model) &&
          model.object === "model" &&
          typeof model.id === "string" &&
          model.id.length > 0
        )
      ) {
        throw new HermesApiError("HERMES_INCOMPATIBLE", "Hermes model list is invalid");
      }
      const modelIds = models.data
        .map((model) => model.id)
        .filter((id): id is string => typeof id === "string");
      if (!modelIds.includes(profileName)) {
        throw new HermesApiError("HERMES_INCOMPATIBLE", "Expected Joblit Hermes profile is not active");
      }
      if (
        !isRecord(toolsets) ||
        toolsets.object !== "list" ||
        toolsets.platform !== "api_server" ||
        !Array.isArray(toolsets.data) ||
        !toolsets.data.every((toolset) =>
          isRecord(toolset) &&
          typeof toolset.name === "string" &&
          toolset.name.length > 0 &&
          typeof toolset.enabled === "boolean" &&
          typeof toolset.configured === "boolean" &&
          Array.isArray(toolset.tools) &&
          toolset.tools.every((tool) => typeof tool === "string")
        )
      ) {
        throw new HermesApiError("HERMES_INCOMPATIBLE", "Hermes toolset list is invalid");
      }
      const validatedToolsets = toolsets.data as Array<{ enabled: boolean; tools: string[] }>;
      const tools = validatedToolsets.flatMap((toolset) =>
        toolset.enabled === true && Array.isArray(toolset.tools)
          ? toolset.tools
          : [],
      );
      if (tools.length > 0) {
        throw new HermesApiError("HERMES_INCOMPATIBLE", "Joblit Hermes profile advertises executable tools");
      }
      // Functional readiness: capabilities alone cannot prove runs will be
      // dispatched. A stopped gateway accepts runs that then sit undispatched
      // forever, so "Ready" must require a running gateway and a healthy model.
      try {
        const detailed = await request("/health/detailed", {}, PROBE_TIMEOUT_MS);
        if (isRecord(detailed)) {
          const readiness = isRecord(detailed.readiness) ? detailed.readiness : undefined;
          const checks = readiness && isRecord(readiness.checks) ? readiness.checks : undefined;
          const model = checks && isRecord(checks.model) ? checks.model : undefined;
          if (
            detailed.gateway_state !== "running" ||
            (model !== undefined && model.status !== "ok")
          ) {
            throw new HermesApiError(
              "HERMES_UNREACHABLE",
              "Hermes gateway is not running; local runs would never be dispatched",
              { retryable: true },
            );
          }
        }
      } catch (error) {
        // Older builds without /health/detailed stay compatible; only a
        // confirmed stopped gateway or auth issue should fail the probe.
        if (
          error instanceof HermesApiError &&
          (error.status === undefined || error.status !== 404)
        ) {
          throw error;
        }
      }
      try {
        await request(
          "/v1/runs",
          { method: "POST", body: "{}" },
          PROBE_TIMEOUT_MS,
        );
        throw new HermesApiError("HERMES_INCOMPATIBLE", "Hermes accepted an empty run probe");
      } catch (error) {
        if (!(error instanceof HermesApiError && error.status === 400)) throw error;
      }
      return { modelId: profileName, profileName, tools };
    },

    async startRun(body) {
      if (
        typeof body.input !== "string" ||
        body.input.length === 0 ||
        body.input.length > 160_000 ||
        typeof body.instructions !== "string" ||
        body.instructions.length === 0 ||
        body.instructions.length > 160_000 ||
        typeof body.session_id !== "string" ||
        body.session_id.length > 64
      ) {
        throw new HermesApiError("HERMES_PROTOCOL_ERROR", "Invalid Hermes run body");
      }
      const result = await request(
        "/v1/runs",
        { method: "POST", body: JSON.stringify(body) },
        REQUEST_TIMEOUT_MS,
        true,
      );
      if (
        !isRecord(result) ||
        result.status !== "started" ||
        typeof result.run_id !== "string" ||
        !RUN_ID_RE.test(result.run_id)
      ) {
        throw new HermesApiError("HERMES_PROTOCOL_ERROR", "Hermes start response is invalid", { ambiguousStart: true });
      }
      return { runId: result.run_id };
    },

    async getRun(rawRunId) {
      const runId = validateRunId(rawRunId);
      const result = await request(`/v1/runs/${runId}`, {}, REQUEST_TIMEOUT_MS, false, true);
      if (
        !isRecord(result) ||
        result.object !== "hermes.run" ||
        result.run_id !== runId ||
        typeof result.status !== "string" ||
        !STOCK_RUN_STATUSES.has(result.status as HermesRunStatus)
      ) {
        throw new HermesApiError("HERMES_PROTOCOL_ERROR", "Hermes run response is invalid");
      }
      if (result.output !== undefined && (typeof result.output !== "string" || result.output.length > MAX_MODEL_OUTPUT_CHARS)) {
        throw new HermesApiError("HERMES_RESPONSE_TOO_LARGE", "Hermes output is invalid or oversized");
      }
      if (result.error !== undefined && typeof result.error !== "string") {
        throw new HermesApiError("HERMES_PROTOCOL_ERROR", "Hermes run error is invalid");
      }
      return {
        object: "hermes.run",
        runId,
        status: result.status as HermesRunStatus,
        ...(typeof result.output === "string" ? { output: result.output } : {}),
        ...(typeof result.error === "string" ? { error: result.error } : {}),
        ...(typeof result.session_id === "string" ? { sessionId: result.session_id } : {}),
      };
    },

    async stopRun(rawRunId) {
      const runId = validateRunId(rawRunId);
      const result = await request(`/v1/runs/${runId}/stop`, { method: "POST" }, REQUEST_TIMEOUT_MS, false, true);
      if (!isRecord(result) || result.run_id !== runId || result.status !== "stopping") {
        throw new HermesApiError("HERMES_PROTOCOL_ERROR", "Hermes stop response is invalid");
      }
    },

    async sessionChat(sessionId, message) {
      if (!SESSION_ID_RE.test(sessionId)) {
        throw new HermesApiError("HERMES_PROTOCOL_ERROR", "Invalid Hermes session id");
      }
      if (typeof message !== "string" || message.length === 0 || message.length > 4_000) {
        throw new HermesApiError("HERMES_PROTOCOL_ERROR", "Invalid Hermes repair message");
      }
      const result = await request(
        `/api/sessions/${encodeURIComponent(sessionId)}/chat`,
        { method: "POST", body: JSON.stringify({ message }) },
        SESSION_CHAT_TIMEOUT_MS,
        false,
        true,
      );
      if (
        !isRecord(result) ||
        result.role !== "assistant" ||
        typeof result.content !== "string" ||
        result.content.length === 0 ||
        result.content.length > MAX_MODEL_OUTPUT_CHARS
      ) {
        throw new HermesApiError("HERMES_PROTOCOL_ERROR", "Hermes chat response is invalid");
      }
      return result.content;
    },

    async peekRunProgress(rawRunId) {
      const runId = validateRunId(rawRunId);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PROGRESS_PEEK_TIMEOUT_MS);
      try {
        const response = await fetch(`${baseUrl}/v1/runs/${runId}/events`, {
          redirect: "error",
          signal: controller.signal,
          headers: { Accept: "text/event-stream", Authorization: `Bearer ${apiKey}` },
        });
        if (!response.ok || !response.body) return null;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let text = "";
        try {
          while (text.length < MAX_JSON_BYTES) {
            const { done, value } = await reader.read();
            if (done) break;
            text += decoder.decode(value, { stream: true });
          }
        } finally {
          await reader.cancel().catch(() => undefined);
          reader.releaseLock();
        }
        let chars = 0;
        for (const line of text.split("\n")) {
          if (!line.startsWith("data:")) continue;
          try {
            const event: unknown = JSON.parse(line.slice(5));
            if (isRecord(event) && event.event === "message.delta" && typeof event.delta === "string") {
              chars += event.delta.length;
            }
          } catch {
            // Partial SSE frame at the abort boundary; ignore.
          }
        }
        return chars > 0 ? Math.min(chars, MAX_MODEL_OUTPUT_CHARS) : null;
      } catch {
        // Progress is decorative; never let a peek failure disturb the run.
        return null;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
