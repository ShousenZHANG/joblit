import type { DetectedField, FormDetectionResult } from "@ext/shared/types";
import { classifyField, buildSelector, getInputType } from "./fieldClassifier";
import type { AtsAdapter } from "./atsAdapters/types";
import { getAdapter } from "./atsAdapters";
import { filterSafeFields } from "@ext/shared/sensitiveFields";

/** Input types that should be skipped. */
const SKIP_TYPES = new Set(["hidden", "submit", "button", "reset", "image"]);

/** Selectors for form input elements. */
const INPUT_SELECTOR = "input, textarea, select, [contenteditable='true']";

// jsdom does not perform layout, so `offsetParent` is always `null` and
// `getComputedStyle` may return empty strings. Bundlers inline
// `process.env.NODE_ENV` at build time, so the test branch is dead code in the
// production extension bundle.
const IS_TEST_ENV =
  typeof process !== "undefined" && process.env?.NODE_ENV === "test";

/** Check if an element is visible and interactive. */
function isVisible(el: HTMLElement): boolean {
  if (el.getAttribute("aria-hidden") === "true") return false;
  if (el instanceof HTMLInputElement && el.type === "hidden") return false;

  const style =
    typeof getComputedStyle === "function" ? getComputedStyle(el) : el.style;

  if (style.display === "none" || style.visibility === "hidden") return false;
  const opacity = parseFloat(style.opacity);
  if (Number.isFinite(opacity) && opacity === 0) return false;

  // Skip layout-based offscreen check in jsdom — there is no layout engine,
  // so every element has `offsetParent === null` regardless of CSS.
  if (
    !IS_TEST_ENV &&
    typeof el.offsetParent !== "undefined" &&
    el.offsetParent === null &&
    style.position !== "fixed" &&
    style.position !== "sticky"
  ) {
    return false;
  }

  return true;
}

/**
 * Collect matching elements across the light DOM AND any OPEN shadow roots,
 * recursively. Plain `querySelectorAll` does not pierce shadow boundaries, so
 * forms built from web components (Salesforce LWC, design-system inputs, etc.)
 * were invisible to detection. Closed shadow roots remain inaccessible by
 * design — no script can reach them. Cross-origin iframes are handled
 * separately by the content script's `all_frames` injection.
 */
function queryInputsDeep(
  root: Document | ShadowRoot,
  selector: string,
  out: HTMLElement[],
  depth = 0,
): void {
  if (depth > 8) return; // guard against pathological shadow nesting
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(selector))) {
    out.push(el);
  }
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
    const shadow = el.shadowRoot;
    if (shadow) queryInputsDeep(shadow, selector, out, depth + 1);
  }
}

/** Detect all fillable fields in a document. */
export function detectFields(doc: Document, adapter: AtsAdapter): DetectedField[] {
  // Try ATS-specific detection first; fall through to generic if no fields found
  const atsFields = adapter.detectFields(doc);
  if (atsFields.length > 0) return filterSafeFields(atsFields);

  // Fallback: generic detection (also used when ATS adapter returns 0 fields).
  // Deep-collect so web-component (shadow DOM) forms are reachable.
  const elements: HTMLElement[] = [];
  queryInputsDeep(doc, INPUT_SELECTOR, elements);
  const fields: DetectedField[] = [];

  for (const el of elements) {
    const inputType = getInputType(el);
    if (SKIP_TYPES.has(inputType)) continue;
    if (!isVisible(el)) continue;
    if (
      (el as HTMLInputElement).disabled ||
      el.getAttribute("aria-disabled") === "true"
    ) continue;
    // Allow readonly inputs that are part of dropdown/combobox components
    // (React Select uses readonly inputs as click triggers)
    if ((el as HTMLInputElement).readOnly) {
      const role = el.getAttribute("role");
      const parentRole = el.parentElement?.getAttribute("role");
      if (role !== "combobox" && role !== "listbox" && parentRole !== "combobox" && parentRole !== "listbox") {
        continue; // Skip truly readonly fields
      }
    }

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

  return filterSafeFields(fields);
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
