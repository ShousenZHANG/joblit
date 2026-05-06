/**
 * Observability seam.
 *
 * Single entry point for reporting unexpected errors / capturing
 * structured events. Routes today log to stderr; flipping the project
 * to Sentry / Datadog / Honeycomb means swapping the implementation
 * here, not editing every catch block.
 *
 * To wire Sentry:
 *   1. npm install --save @sentry/nextjs
 *   2. Set SENTRY_DSN env var
 *   3. Replace the body of report() / capture() with the SDK call
 *
 * Not adding the SDK as a dep yet because it's a large install and
 * needs DSN provisioning.
 */

const SERVICE = "joblit-web";

export type ErrorSeverity = "info" | "warning" | "error" | "fatal";

export interface ErrorContext {
  /** Stable identifier for the location, e.g. "fetch-runs.create". */
  scope: string;
  /** Severity. Defaults to "error". */
  severity?: ErrorSeverity;
  /** Authenticated user identifier, if available. */
  userId?: string;
  /** Request-id from the API helper (errorResponse.createRequestId). */
  requestId?: string;
  /** Free-form structured tags. */
  tags?: Record<string, string | number | boolean | undefined>;
  /** Free-form structured extras. */
  extra?: Record<string, unknown>;
}

export interface CapturedEvent {
  /** Stable identifier, e.g. "batch.task.skipped". */
  name: string;
  /** Severity. Defaults to "info". */
  severity?: ErrorSeverity;
  userId?: string;
  requestId?: string;
  tags?: Record<string, string | number | boolean | undefined>;
  extra?: Record<string, unknown>;
}

/**
 * Report an exception. Call from `catch` blocks where the error is
 * unexpected (i.e. not a domain-level validation result).
 */
export function reportError(error: unknown, context: ErrorContext): void {
  const severity = context.severity ?? "error";
  const message = extractMessage(error);
  const stack = error instanceof Error ? error.stack : undefined;

  emit({
    type: "error",
    service: SERVICE,
    severity,
    scope: context.scope,
    message,
    stack,
    userId: context.userId,
    requestId: context.requestId,
    tags: context.tags,
    extra: context.extra,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Capture a structured event. Use for noteworthy non-error events
 * (large batch completed, rate-limit hit, prompt skill changed, etc.).
 */
export function captureEvent(event: CapturedEvent): void {
  emit({
    type: "event",
    service: SERVICE,
    severity: event.severity ?? "info",
    name: event.name,
    userId: event.userId,
    requestId: event.requestId,
    tags: event.tags,
    extra: event.extra,
    timestamp: new Date().toISOString(),
  });
}

/* ────────────────────────── internals ────────────────────────── */

interface EmitPayload {
  type: "error" | "event";
  service: string;
  severity: ErrorSeverity;
  timestamp: string;
  scope?: string;
  message?: string;
  stack?: string;
  name?: string;
  userId?: string;
  requestId?: string;
  tags?: Record<string, string | number | boolean | undefined>;
  extra?: Record<string, unknown>;
}

function emit(payload: EmitPayload): void {
  // TODO: when @sentry/nextjs is installed, route errors to
  // Sentry.captureException and events to Sentry.captureMessage.
  // Until then, structured stderr is enough for log-aggregation
  // pipelines (Vercel / Datadog log drains will pick it up).
  if (payload.type === "error") {
    console.error(JSON.stringify(payload));
  } else {
    console.info(JSON.stringify(payload));
  }
}

function extractMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "[unserializable error]";
  }
}
