export const BRIDGE_CHANNEL = "joblit.hermes.v1" as const;
export const BRIDGE_VERSION = 1 as const;
export const JOBLIT_WEB_ORIGIN = "https://www.joblit.tech" as const;
const BRIDGE_REQUEST_TTL_MS = 30_000;
const BRIDGE_CLOCK_SKEW_MS = 5_000;
const MAX_BRIDGE_REQUEST_BYTES = 4_096;
export const MAX_BRIDGE_RESPONSE_BYTES = 96_000;
export const MIN_MODEL_OUTPUT_CHARS = 20;
export const MAX_MODEL_OUTPUT_CHARS = 80_000;

export type LocalAiTarget = "resume" | "cover" | "match" | "triage";

export const MAX_TRIAGE_JOBS = 15;

export interface BridgeEnvelopeBase {
  channel: typeof BRIDGE_CHANNEL;
  version: typeof BRIDGE_VERSION;
  messageId: string;
  nonce: string;
}

export type BridgeRequest = BridgeEnvelopeBase & {
  direction: "web-to-extension";
  issuedAt: number;
  expiresAt: number;
} & (
    | { action: "PING" | "GET_STATUS"; payload: Record<string, never> }
    | { action: "START_RUN"; payload: StartRunPayload }
    | { action: "GET_RUN" | "STOP_RUN"; payload: RunLookupPayload }
    | { action: "REPAIR_RUN"; payload: RepairRunPayload }
  );

export interface StartRunPayload {
  requestId: string;
  /** For "triage" batches this is the representative first job id. */
  jobId: string;
  target: LocalAiTarget;
  /** Present (1..15 ids, jobIds[0] === jobId) only when target is "triage". */
  jobIds?: string[];
}

export interface RunLookupPayload {
  requestId: string;
}

export const MAX_REPAIR_FEEDBACK_CHARS = 1_200;

export interface RepairRunPayload {
  requestId: string;
  feedback: string;
}

export type LocalAiStatusState =
  | "not_configured"
  | "joblit_disconnected"
  | "unreachable"
  | "auth_failed"
  | "incompatible"
  | "ready";

export interface PublicLocalAiStatus {
  state: LocalAiStatusState;
  joblitConnected: boolean;
  profileName?: string;
}

export interface PublicBridgePresence {
  present: true;
}

export type PublicRunStatus =
  | "queued"
  | "running"
  | "stopping"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface PublicRunBase {
  requestId: string;
  jobId: string;
  target: LocalAiTarget;
  status: PublicRunStatus;
}

export interface PublicRunProgress {
  /** Approximate characters of model output observed so far (best-effort). */
  progressChars?: number;
}

export interface PublicRunSuccess extends PublicRunBase {
  status: "succeeded";
  modelOutput: string;
  promptMeta: Record<string, unknown>;
}

export interface PublicRunFailure extends PublicRunBase {
  status: "failed";
  error: PublicLocalAiError;
}

export type PublicRunResult =
  | PublicRunSuccess
  | PublicRunFailure
  | (PublicRunBase & PublicRunProgress & { status: "queued" | "running" | "stopping" | "cancelled" });

export interface PublicLocalAiError {
  code: LocalAiErrorCode;
  message: string;
  retryable: boolean;
}

export type LocalAiErrorCode =
  | "EXTENSION_STORAGE_UNAVAILABLE"
  | "FORBIDDEN_CALLER"
  | "INVALID_REQUEST"
  | "RATE_LIMITED"
  | "HERMES_NOT_CONFIGURED"
  | "HERMES_UNREACHABLE"
  | "HERMES_AUTH_FAILED"
  | "HERMES_ORIGIN_FORBIDDEN"
  | "HERMES_INCOMPATIBLE"
  | "HERMES_RATE_LIMITED"
  | "HERMES_RESPONSE_TOO_LARGE"
  | "HERMES_PROTOCOL_ERROR"
  | "RUN_START_UNKNOWN"
  | "RUN_LOST"
  | "UNEXPECTED_APPROVAL_REQUIRED"
  | "AI_OUTPUT_INVALID"
  | "HERMES_RUN_FAILED";

const LOCAL_AI_ERROR_CODES = new Set<LocalAiErrorCode>([
  "EXTENSION_STORAGE_UNAVAILABLE",
  "FORBIDDEN_CALLER",
  "INVALID_REQUEST",
  "RATE_LIMITED",
  "HERMES_NOT_CONFIGURED",
  "HERMES_UNREACHABLE",
  "HERMES_AUTH_FAILED",
  "HERMES_ORIGIN_FORBIDDEN",
  "HERMES_INCOMPATIBLE",
  "HERMES_RATE_LIMITED",
  "HERMES_RESPONSE_TOO_LARGE",
  "HERMES_PROTOCOL_ERROR",
  "RUN_START_UNKNOWN",
  "RUN_LOST",
  "UNEXPECTED_APPROVAL_REQUIRED",
  "AI_OUTPUT_INVALID",
  "HERMES_RUN_FAILED",
]);

export interface BridgeSuccessResponse extends BridgeEnvelopeBase {
  direction: "extension-to-web";
  ok: true;
  data: PublicBridgePresence | PublicLocalAiStatus | PublicRunResult;
}

export interface BridgeErrorResponse extends BridgeEnvelopeBase {
  direction: "extension-to-web";
  ok: false;
  error: PublicLocalAiError;
}

export type BridgeResponse = BridgeSuccessResponse | BridgeErrorResponse;

export type HermesRunStatus =
  | "queued"
  | "running"
  | "waiting_for_approval"
  | "stopping"
  | "completed"
  | "failed"
  | "cancelled";

export interface HermesRun {
  object: "hermes.run";
  runId: string;
  status: HermesRunStatus;
  output?: string;
  error?: string;
  sessionId?: string;
}

export interface HermesProbeResult {
  modelId: string;
  profileName: string;
  tools: string[];
}

export interface HermesSettingsPublic {
  baseUrl: string;
  profileName: string;
  hasApiKey: boolean;
  configured: boolean;
}

export interface HermesSettingsInput {
  baseUrl: string;
  profileName: string;
  apiKey?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NONCE_RE = /^[A-Za-z0-9_-]{16,128}$/;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && expected.slice().sort().every((key, index) => key === actual[index]);
}

function jsonBytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function isStartRunPayload(value: unknown): value is StartRunPayload {
  if (!isPlainRecord(value) || !isUuid(value.requestId) || !isUuid(value.jobId)) return false;
  if (value.target === "triage") {
    return (
      hasExactKeys(value, ["jobId", "jobIds", "requestId", "target"]) &&
      Array.isArray(value.jobIds) &&
      value.jobIds.length >= 1 &&
      value.jobIds.length <= MAX_TRIAGE_JOBS &&
      value.jobIds.every((id) => isUuid(id)) &&
      value.jobIds[0] === value.jobId &&
      new Set(value.jobIds).size === value.jobIds.length
    );
  }
  return (
    hasExactKeys(value, ["jobId", "requestId", "target"]) &&
    (value.target === "resume" || value.target === "cover" || value.target === "match")
  );
}

export function isRunLookupPayload(value: unknown): value is RunLookupPayload {
  return isPlainRecord(value) && hasExactKeys(value, ["requestId"]) && isUuid(value.requestId);
}

export function isRepairRunPayload(value: unknown): value is RepairRunPayload {
  return (
    isPlainRecord(value) &&
    hasExactKeys(value, ["feedback", "requestId"]) &&
    isUuid(value.requestId) &&
    typeof value.feedback === "string" &&
    value.feedback.length > 0 &&
    value.feedback.length <= MAX_REPAIR_FEEDBACK_CHARS &&
    // Feedback is untrusted display/data text; refuse control characters.
    !/[\u0000-\u001f\u007f-\u009f]/.test(value.feedback)
  );
}

export function parseBridgeRequest(value: unknown, now = Date.now()): BridgeRequest | null {
  if (!isPlainRecord(value) || jsonBytes(value) > MAX_BRIDGE_REQUEST_BYTES) return null;
  if (
    !hasExactKeys(value, [
      "action",
      "channel",
      "direction",
      "expiresAt",
      "issuedAt",
      "messageId",
      "nonce",
      "payload",
      "version",
    ]) ||
    value.channel !== BRIDGE_CHANNEL ||
    value.direction !== "web-to-extension" ||
    value.version !== BRIDGE_VERSION ||
    !isUuid(value.messageId) ||
    typeof value.nonce !== "string" ||
    !NONCE_RE.test(value.nonce) ||
    typeof value.issuedAt !== "number" ||
    !Number.isFinite(value.issuedAt) ||
    typeof value.expiresAt !== "number" ||
    !Number.isFinite(value.expiresAt) ||
    value.issuedAt > now + BRIDGE_CLOCK_SKEW_MS ||
    value.issuedAt < now - BRIDGE_REQUEST_TTL_MS ||
    value.expiresAt <= now ||
    value.expiresAt > value.issuedAt + BRIDGE_REQUEST_TTL_MS
  ) {
    return null;
  }

  if (value.action === "PING" || value.action === "GET_STATUS") {
    if (!isPlainRecord(value.payload) || !hasExactKeys(value.payload, [])) return null;
  } else if (value.action === "START_RUN") {
    if (!isStartRunPayload(value.payload)) return null;
  } else if (value.action === "GET_RUN" || value.action === "STOP_RUN") {
    if (!isRunLookupPayload(value.payload)) return null;
  } else if (value.action === "REPAIR_RUN") {
    if (!isRepairRunPayload(value.payload)) return null;
  } else {
    return null;
  }
  return value as unknown as BridgeRequest;
}

export function validatePublicLocalAiStatus(value: unknown): value is PublicLocalAiStatus {
  if (!isPlainRecord(value)) return false;
  const allowed = new Set<LocalAiStatusState>([
    "not_configured",
    "joblit_disconnected",
    "unreachable",
    "auth_failed",
    "incompatible",
    "ready",
  ]);
  if (!allowed.has(value.state as LocalAiStatusState) || typeof value.joblitConnected !== "boolean") return false;
  if (value.profileName !== undefined && (typeof value.profileName !== "string" || value.profileName.length > 64)) return false;
  return hasExactKeys(value, value.profileName === undefined ? ["joblitConnected", "state"] : ["joblitConnected", "profileName", "state"]);
}

export function validatePublicRunResult(value: unknown): value is PublicRunResult {
  if (!isPlainRecord(value) || jsonBytes(value) > MAX_BRIDGE_RESPONSE_BYTES) return false;
  if (
    !isUuid(value.requestId) ||
    !isUuid(value.jobId) ||
    (value.target !== "resume" &&
      value.target !== "cover" &&
      value.target !== "match" &&
      value.target !== "triage")
  ) {
    return false;
  }
  if (["run_id", "runId", "prompt", "endpoint", "apiKey", "token"].some((key) => key in value)) return false;
  if (value.status === "succeeded") {
    return (
      hasExactKeys(value, ["jobId", "modelOutput", "promptMeta", "requestId", "status", "target"]) &&
      typeof value.modelOutput === "string" &&
      value.modelOutput.length >= MIN_MODEL_OUTPUT_CHARS &&
      value.modelOutput.length <= MAX_MODEL_OUTPUT_CHARS &&
      isPlainRecord(value.promptMeta)
    );
  }
  if (value.status === "failed") {
    return hasExactKeys(value, ["error", "jobId", "requestId", "status", "target"]) && isPublicLocalAiError(value.error);
  }
  if (
    value.status !== "queued" &&
    value.status !== "running" &&
    value.status !== "stopping" &&
    value.status !== "cancelled"
  ) {
    return false;
  }
  if (value.progressChars !== undefined) {
    return (
      hasExactKeys(value, ["jobId", "progressChars", "requestId", "status", "target"]) &&
      typeof value.progressChars === "number" &&
      Number.isInteger(value.progressChars) &&
      value.progressChars >= 0 &&
      value.progressChars <= MAX_MODEL_OUTPUT_CHARS
    );
  }
  return hasExactKeys(value, ["jobId", "requestId", "status", "target"]);
}

export function isPublicLocalAiError(value: unknown): value is PublicLocalAiError {
  return (
    isPlainRecord(value) &&
    hasExactKeys(value, ["code", "message", "retryable"]) &&
    typeof value.code === "string" &&
    LOCAL_AI_ERROR_CODES.has(value.code as LocalAiErrorCode) &&
    typeof value.message === "string" &&
    value.message.length > 0 &&
    value.message.length <= 240 &&
    typeof value.retryable === "boolean"
  );
}

export function jsonByteLength(value: unknown): number {
  return jsonBytes(value);
}
