import { errorJson } from "@/lib/server/api/errorResponse";
import { reportError } from "@/lib/server/observability/errorReporter";
import {
  APPLICATION_ARTIFACT_STORAGE_UNAVAILABLE,
  type CommitResult,
} from "./commitApplicationArtifact";

/**
 * One mapping from a commit rejection to an HTTP response, shared by every
 * caller of `commitApplicationArtifact`.
 *
 * It exists because DRAFT and FINAL had drifted into two different mappings of
 * the same union. FINAL mapped each kind to 422/409/503; DRAFT mapped exactly
 * one and collapsed the rest into a bare 500. That difference took production
 * down: the Runner treats any 5xx as "settlement unknown", so a deterministic,
 * non-retryable rejection was replayed three times, deferred, and left holding
 * its task lease — a stall that no retry could clear, from a failure the
 * server had already classified correctly one branch over.
 *
 * The status codes carry the contract the Runner reads:
 *   4xx — deterministic. Stop, report, move on.
 *   5xx — genuinely unknown. Replay the receipt.
 * Anything that lands in `default` is a kind nobody mapped, so it is reported
 * before it is answered. Silence there is what made this expensive to find.
 */
export function commitRejectionResponse(
  result: Exclude<CommitResult, { kind: "committed" }>,
  context: {
    requestId: string;
    /** Distinguishes the DRAFT and FINAL call sites in error reports. */
    scope: string;
    userId?: string;
    jobId?: string;
    target?: string;
  },
) {
  const { requestId } = context;
  const tags = {
    ...(context.jobId ? { jobId: context.jobId } : {}),
    ...(context.target ? { target: context.target } : {}),
  };

  switch (result.kind) {
    case "invalid_ai_content":
      return errorJson(
        "AI_CONTENT_INVALID",
        "The stored application content cannot be safely merged. Re-generate both targets.",
        409,
        { requestId },
      );

    case "stale_render_context":
      return errorJson(
        "STALE_RENDER_CONTEXT",
        "Your resume profile or job changed while the PDF was rendering. Generate it again.",
        409,
        { requestId },
      );

    case "stale_write":
      // Another writer committed first. Deterministic and safe to retry from
      // the top, so it must not read as an unknown settlement.
      return errorJson(
        "STALE_WRITE",
        "This application changed while the draft was being saved. Generate it again.",
        409,
        { requestId },
      );

    case "job_missing":
      return errorJson("JOB_NOT_FOUND", "Job not found", 404, { requestId });

    case "blob_not_configured":
      return errorJson(
        APPLICATION_ARTIFACT_STORAGE_UNAVAILABLE.code,
        APPLICATION_ARTIFACT_STORAGE_UNAVAILABLE.message,
        APPLICATION_ARTIFACT_STORAGE_UNAVAILABLE.status,
        { requestId },
      );

    case "upload_failed":
      // An upload failure used to be swallowed, committing a null URL that
      // cleared the user's previous PDF. It is a plain failure, and genuinely
      // worth retrying — 5xx is correct here.
      reportError(result.cause, {
        scope: `${context.scope}.blob-upload`,
        userId: context.userId,
        tags,
      });
      return errorJson(
        "APPLICATION_PERSIST_FAILED",
        "The PDF was rendered but could not be saved. Please try again.",
        500,
        { requestId },
      );

    default: {
      // A kind added to CommitResult without a mapping here. Report it — the
      // previous version of this code answered 500 in silence, which is why a
      // deterministic failure looked like an outage for days.
      const unmapped: never = result;
      reportError(new Error("Unmapped commit result kind"), {
        scope: `${context.scope}.unmapped-commit-kind`,
        userId: context.userId,
        tags,
        extra: { result: unmapped },
      });
      return errorJson(
        "APPLICATION_PERSIST_FAILED",
        "Could not save the application. Please try again.",
        500,
        { requestId },
      );
    }
  }
}
