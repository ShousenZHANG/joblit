import type { DetectedField } from "@ext/shared/types";
import { sendMessage } from "@ext/shared/messaging";
import { isJobApplicationContext } from "@ext/shared/jobContext";
import { filterSafeFields } from "@ext/shared/sensitiveFields";
import { generateFormSignature } from "../detector/similarity";

/** Capture a snapshot of all field values at submission time. */
export function captureFieldSnapshot(
  fields: DetectedField[],
): Record<string, string> {
  const snapshot: Record<string, string> = {};
  for (const field of filterSafeFields(fields)) {
    const key = field.name || field.id || field.selector;
    const el = field.element;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      snapshot[key] = el.value;
    } else if (el instanceof HTMLSelectElement) {
      snapshot[key] = el.value;
    } else if (el.getAttribute("contenteditable") === "true") {
      snapshot[key] = el.textContent ?? "";
    }
  }
  return snapshot;
}

/** Build mapping metadata for each field. */
export function buildFieldMappings(
  fields: DetectedField[],
): Record<string, { source: string; profilePath?: string; confidence: number }> {
  const mappings: Record<string, { source: string; profilePath?: string; confidence: number }> = {};
  for (const field of filterSafeFields(fields)) {
    const key = field.name || field.id || field.selector;
    mappings[key] = {
      source: field.confidence > 0 ? "profile" : "manual",
      profilePath: field.category !== "unknown" ? field.category : undefined,
      confidence: field.confidence,
    };
  }
  return mappings;
}

/** Extract domain from URL. */
export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/** Record a form submission to the backend via background worker. */
export async function recordSubmission(
  fields: DetectedField[],
  atsProvider: string,
): Promise<void> {
  const pageUrl = window.location.href;
  if (!isJobApplicationContext(pageUrl)) return;

  const safeFields = filterSafeFields(fields);
  const fieldValues = captureFieldSnapshot(safeFields);
  const fieldMappings = buildFieldMappings(safeFields);
  const formSignature = generateFormSignature(safeFields);
  const pageDomain = extractDomain(pageUrl);

  await sendMessage({
    type: "RECORD_SUBMISSION",
    data: {
      pageUrl,
      pageDomain,
      atsProvider,
      formSignature,
      fieldValues,
      fieldMappings,
    },
  });
}

/** Intercept form submit events on the page. */
export function interceptFormSubmits(
  fields: DetectedField[],
  atsProvider: string,
): () => void {
  if (!isJobApplicationContext(window.location.href)) return () => {};

  const handler = (_e: SubmitEvent) => {
    // Record asynchronously — don't block the submit
    recordSubmission(fields, atsProvider).catch(() => {
      // Silently fail — don't break the user's application
    });
  };

  // Listen on all forms
  const forms = document.querySelectorAll("form");
  for (const form of forms) {
    form.addEventListener("submit", handler);
  }

  // Return cleanup function
  return () => {
    for (const form of forms) {
      form.removeEventListener("submit", handler);
    }
  };
}
