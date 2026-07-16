import type { LocalAiErrorCode, PublicLocalAiError } from "@ext/shared/hermesTypes";

/** HTTP request failure that preserves the response status for retry policy. */
export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export type HermesInternalErrorCode =
  | LocalAiErrorCode
  | "HERMES_RUN_NOT_FOUND"
  | "HERMES_SETTINGS_INVALID";

export class HermesApiError extends Error {
  readonly retryable: boolean;
  readonly status?: number;
  readonly ambiguousStart: boolean;

  constructor(
    public readonly code: HermesInternalErrorCode,
    message: string,
    options: { retryable?: boolean; status?: number; ambiguousStart?: boolean } = {},
  ) {
    super(message);
    this.name = "HermesApiError";
    this.retryable = options.retryable ?? false;
    this.status = options.status;
    this.ambiguousStart = options.ambiguousStart ?? false;
  }
}

const PUBLIC_ERROR_MESSAGES: Record<LocalAiErrorCode, string> = {
  EXTENSION_STORAGE_UNAVAILABLE: "Secure extension storage is unavailable.",
  FORBIDDEN_CALLER: "This Local AI request is not allowed.",
  INVALID_REQUEST: "The Local AI request is invalid.",
  RATE_LIMITED: "Too many Local AI requests. Wait a moment and try again.",
  HERMES_NOT_CONFIGURED: "Set up Hermes Local AI in the Joblit extension.",
  HERMES_UNREACHABLE: "Hermes is unavailable. Start the local Hermes gateway and try again.",
  HERMES_AUTH_FAILED: "Hermes authentication failed. Check the local API key.",
  HERMES_INCOMPATIBLE: "This Hermes profile is not compatible with Joblit Local AI.",
  HERMES_RATE_LIMITED: "Hermes is busy. Wait a moment and try again.",
  HERMES_RESPONSE_TOO_LARGE: "Hermes returned more data than Joblit can safely process.",
  HERMES_PROTOCOL_ERROR: "Hermes returned an unsupported response.",
  RUN_START_UNKNOWN: "Joblit cannot confirm whether Hermes started this run. Start a new attempt.",
  RUN_LOST: "This Hermes run is no longer available. Start a new attempt.",
  UNEXPECTED_APPROVAL_REQUIRED: "Hermes requested a tool approval that the Joblit profile must not use.",
  AI_OUTPUT_INVALID: "Hermes returned an invalid or oversized result.",
  HERMES_RUN_FAILED: "Hermes could not complete this generation.",
};

export function toPublicLocalAiError(error: unknown): PublicLocalAiError {
  if (error instanceof HermesApiError) {
    let code: LocalAiErrorCode;
    if (error.code === "HERMES_RUN_NOT_FOUND") code = "RUN_LOST";
    else if (error.code === "HERMES_SETTINGS_INVALID") code = "HERMES_NOT_CONFIGURED";
    else code = error.code;
    return {
      code,
      message: PUBLIC_ERROR_MESSAGES[code],
      retryable: error.retryable,
    };
  }
  return {
    code: "HERMES_PROTOCOL_ERROR",
    message: PUBLIC_ERROR_MESSAGES.HERMES_PROTOCOL_ERROR,
    retryable: false,
  };
}

/** Return whether a failed API request is safe to retry later. */
export function isRetryableApiError(error: unknown): boolean {
  if (error instanceof TypeError) return true;

  if (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  ) {
    return true;
  }

  if (!(error instanceof ApiRequestError)) return false;

  return (
    error.status === 408 ||
    error.status === 425 ||
    error.status === 429 ||
    (error.status >= 500 && error.status <= 599)
  );
}
