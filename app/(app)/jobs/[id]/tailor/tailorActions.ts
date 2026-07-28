import { fetchJson } from "@/lib/api/fetchJson";
import {
  discardResultSchema,
  finalizeResultSchema,
  type DiscardResponse,
  type FinalizeResponse,
} from "./tailorResponseSchemas";

/**
 * The Edit phase's three server actions, owned once.
 *
 * ADR-0002 requires both generate paths to converge on the Edit phase. It does
 * not require two implementations of it, and two is what existed: the review
 * dialog and the `/jobs/[id]/tailor` page each carried their own finalize,
 * preview and discard calls.
 *
 * They had drifted in a way that mattered. The dialog validated that a preview
 * response was actually a PDF, read `Retry-After` on a rate limit, and could
 * abort an in-flight render; the route page's copy did none of that and would
 * hand a `text/html` error page to the PDF viewer as though it were a document.
 * Which protections a user got depended on which surface they happened to open.
 *
 * The stronger behaviour is the one kept here.
 */

export type TailorTarget = "resume" | "cover";

/** Seconds to wait, or null when the header says nothing useful. */
export function parseRetryAfterSeconds(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number.parseInt(value, 10);
  // 0 means "retry now", so there is no window worth telling the user about.
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

export function extractMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

async function readErrorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  const payload = (await response.json().catch(() => null)) as
    | { error?: { message?: unknown } }
    | null;
  const message = payload?.error?.message;
  return typeof message === "string" && message ? message : fallback;
}

export type FinalizeResult = FinalizeResponse;

/** Commit the draft and publish its PDF. */
export async function finalizeApplication(input: {
  applicationId: string;
  target: TailorTarget;
  expectedHash: string | null;
}): Promise<FinalizeResult> {
  return fetchJson(
    `/api/applications/${input.applicationId}/finalize?target=${input.target}`,
    {
      method: "POST",
      body: JSON.stringify({ expectedHash: input.expectedHash }),
      schema: finalizeResultSchema,
    },
  );
}

/**
 * Render the draft without committing it, returning an object URL.
 *
 * Deliberately not `/finalize`: the route page's Refresh button used to call
 * that and flip the Application to `FINAL`, so previewing published the draft.
 * Per CONTEXT.md, `FINAL` asserts the stored PDF reflects committed AI Content,
 * which a preview does not.
 *
 * The caller owns the returned object URL and must revoke it.
 */
export async function renderPreview(input: {
  applicationId: string;
  target: TailorTarget;
  expectedHash: string | null;
  signal?: AbortSignal;
  fallbackMessage?: string;
}): Promise<string> {
  const fallback = input.fallbackMessage ?? "Preview render failed";
  const response = await fetch(
    `/api/applications/${input.applicationId}/preview?target=${input.target}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedHash: input.expectedHash }),
      ...(input.signal ? { signal: input.signal } : {}),
    },
  );

  if (!response.ok) {
    const baseMessage = await readErrorMessage(response, fallback);
    const retryAfterSeconds = parseRetryAfterSeconds(
      response.headers.get("Retry-After"),
    );
    const retryMessage =
      response.status === 429 && retryAfterSeconds !== null
        ? ` Try again in ${retryAfterSeconds} seconds.`
        : "";
    throw new Error(`${baseMessage}${retryMessage}`);
  }

  const blob = await response.blob();
  // A 2xx that is not a PDF is an error page. Handing it to the viewer renders
  // markup as a document instead of reporting the failure.
  if (blob.type !== "application/pdf") {
    throw new Error("Preview service returned an invalid document");
  }
  return URL.createObjectURL(blob);
}

export type DiscardResult = DiscardResponse;

/** Throw away the user's edits and return the server's canonical content. */
export async function discardDraft(input: {
  applicationId: string;
  expectedHash: string | null;
}): Promise<DiscardResult> {
  return fetchJson(
    `/api/applications/${input.applicationId}/discard`,
    {
      method: "POST",
      body: JSON.stringify({ expectedHash: input.expectedHash }),
      schema: discardResultSchema,
    },
  );
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException
    ? err.name === "AbortError"
    : err instanceof Error && err.name === "AbortError";
}
