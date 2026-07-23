import { NextResponse } from "next/server";
import { errorJson } from "@/lib/server/api/errorResponse";
import { reportError } from "@/lib/server/observability/errorReporter";

/**
 * A failure a caller is allowed to see.
 *
 * Throwing an `AppError` from anywhere under `lib/server` produces the
 * documented status and code at the route boundary — no route-level rescue
 * needed. Anything else that reaches the boundary is a bug: it is reported
 * through the observability seam and becomes an untyped 500.
 *
 * The split between `publicMessage` and `privateDetails` is load-bearing.
 * Upstream bodies routinely carry internal hostnames and stack traces;
 * `privateDetails` goes to the reporter and never to the client. Put anything
 * you would not paste into a bug report there.
 */
export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  /** Safe to render in a UI. Never interpolates upstream text. */
  readonly publicMessage: string;
  /** Structured, client-safe context — e.g. a Zod flatten or a validation report. */
  readonly publicDetails?: unknown;
  /** Reported, never returned. */
  readonly privateDetails?: unknown;

  constructor(init: {
    code: string;
    status: number;
    publicMessage: string;
    publicDetails?: unknown;
    privateDetails?: unknown;
    cause?: unknown;
  }) {
    super(init.publicMessage, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = "AppError";
    this.code = init.code;
    this.status = init.status;
    this.publicMessage = init.publicMessage;
    this.publicDetails = init.publicDetails;
    this.privateDetails = init.privateDetails;
  }
}

/**
 * Anything carrying a `code` and a `status` that predates `AppError`.
 *
 * `LatexRenderError`, `AtsPdfValidationError`, `ApplicationPromptError` and
 * `BatchRunnerError` were each written independently; rather than rewrite four
 * class hierarchies at once, recognise the shape they already share.
 */
type CodedError = Error & { code: string; status: number; details?: unknown };

function isCodedError(err: unknown): err is CodedError {
  return (
    err instanceof Error &&
    typeof (err as Partial<CodedError>).code === "string" &&
    typeof (err as Partial<CodedError>).status === "number"
  );
}

/**
 * Render any error as the canonical envelope, or return `null` when it is not
 * a recognised failure and should bubble to a 500.
 *
 * Reports `privateDetails` before returning so redaction is not something a
 * caller can forget — that is the bug this replaces, where one route
 * re-implemented the LaTeX handler without its redaction and returned the raw
 * upstream body to the browser.
 */
export function toErrorResponse(err: unknown, requestId?: string): NextResponse | null {
  if (err instanceof AppError) {
    if (err.privateDetails !== undefined) {
      reportError(err, {
        scope: "app.error",
        requestId,
        tags: { code: err.code, status: String(err.status) },
        extra: { details: err.privateDetails },
      });
    }
    return errorJson(err.code, err.publicMessage, err.status, {
      details: err.publicDetails,
      requestId,
    });
  }

  if (isCodedError(err)) {
    // `details` on these classes is upstream-derived and not known to be safe.
    if (err.details !== undefined) {
      reportError(err, {
        scope: "app.error",
        requestId,
        tags: { code: err.code, status: String(err.status) },
        extra: { details: err.details },
      });
    }
    return errorJson(err.code, err.message, err.status, { requestId });
  }

  return null;
}
