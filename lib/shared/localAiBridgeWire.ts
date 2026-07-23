/**
 * The `joblit.hermes.v1` wire vocabulary, shared by both sides of the bridge.
 *
 * The web app and the Chrome extension are separate npm projects. Before this
 * file they each hand-maintained the envelope constants, the action list and
 * the error codes — the codes three times over, since the extension kept both
 * a type union and a runtime Set. Nothing linked them, so drift was a matter of
 * discipline rather than a compile error.
 *
 * This module is deliberately dependency-free — no Zod, no runtime — so the
 * extension can import it through a path alias without taking on a dependency.
 * Anything needing validation belongs in `localAiBridgeContract.ts` (web) or
 * `hermesTypes.ts` (extension), both of which build on these values.
 */

export const LOCAL_AI_BRIDGE_CHANNEL = "joblit.hermes.v1" as const;
export const LOCAL_AI_BRIDGE_VERSION = 1 as const;
export const LOCAL_AI_BRIDGE_TTL_MS = 30_000;
export const LOCAL_AI_BRIDGE_CLOCK_SKEW_MS = 5_000;
export const LOCAL_AI_BRIDGE_MAX_REQUEST_BYTES = 4_096;
export const LOCAL_AI_BRIDGE_MAX_RESPONSE_BYTES = 96_000;

export const LOCAL_AI_MIN_MODEL_OUTPUT_CHARS = 20;
export const LOCAL_AI_MAX_MODEL_OUTPUT_CHARS = 80_000;

/** Maximum jobs in one triage run — `jobIds[0]` must be the anchor `jobId`. */
export const LOCAL_AI_MAX_TRIAGE_JOBS = 15;

export const LOCAL_AI_BRIDGE_ACTIONS = [
  "PING",
  "GET_STATUS",
  "START_RUN",
  "GET_RUN",
  "STOP_RUN",
  "REPAIR_RUN",
] as const;

export type LocalAiTarget = "resume" | "cover" | "match" | "triage";

/**
 * The single list. Both the type and any runtime guard derive from it, so a new
 * code cannot be added to one and forgotten in the other.
 */
export const LOCAL_AI_ERROR_CODES = [
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
] as const;
export type LocalAiErrorCode = (typeof LOCAL_AI_ERROR_CODES)[number];

const ERROR_CODE_SET: ReadonlySet<string> = new Set(LOCAL_AI_ERROR_CODES);

export function isLocalAiErrorCode(value: unknown): value is LocalAiErrorCode {
  return typeof value === "string" && ERROR_CODE_SET.has(value);
}
