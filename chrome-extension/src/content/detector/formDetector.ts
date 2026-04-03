import type { DetectedField, FormDetectionResult } from "@ext/shared/types";
import { classifyField, buildSelector, getInputType } from "./fieldClassifier";
import type { AtsAdapter } from "./atsAdapters/types";
import { getAdapter } from "./atsAdapters";

/** Input types that should be skipped. */
const SKIP_TYPES = new Set(["hidden", "submit", "button", "reset", "image"]);

/** Selectors for form input elements. */
const INPUT_SELECTOR = "input, textarea, select, [contenteditable='true']";

/** Check if an element is visible and interactive. */
function isVisible(el: HTMLElement): boolean {
  // In jsdom, offsetParent is always null and getComputedStyle may not work,
  // so we check inline styles and attributes instead.
  if (el.getAttribute("type") === "hidden") return false;
  const style = el.style;
  if (style.display === "none" || style.visibility === "hidden") return false;
  // Check aria-hidden
  if (el.getAttribute("aria-hidden") === "true") return false;
  return true;
}

/** Detect all fillable fields in a document. */
export function detectFields(doc: Document, adapter: AtsAdapter): DetectedField[] {
  // Try ATS-specific detection first
  const atsFields = adapter.detectFields(doc);
  if (atsFields.length > 0) return atsFields;

  // Fallback: generic detection
  const elements = doc.querySelectorAll<HTMLElement>(INPUT_SELECTOR);
  const fields: DetectedField[] = [];

  for (const el of elements) {
    const inputType = getInputType(el);
    if (SKIP_TYPES.has(inputType)) continue;
    if (!isVisible(el)) continue;

    const { category, confidence, labelText } = classifyField(el);

    fields.push({
      element: el,
      selector: buildSelector(el),
      inputType,
      category,
      confidence,
      labelText,
      name: el.getAttribute("name") ?? "",
      id: el.id ?? "",
      placeholder: (el as HTMLInputElement).placeholder ?? "",
    });
  }

  return fields;
}

/** Run full form detection on the current page. */
export function detectForms(doc: Document): FormDetectionResult {
  const adapter = getAdapter(doc);
  const fields = detectFields(doc, adapter);
  const forms = Array.from(doc.querySelectorAll("form"));

  return {
    atsProvider: adapter.name,
    fields,
    forms,
  };
}
