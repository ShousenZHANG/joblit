import type { DetectedField } from "@ext/shared/types";
import { FieldCategory, PROFILE_KEY_MAP } from "@ext/shared/fieldTaxonomy";
import { simulateInput, simulateSelect, simulateRadio, simulateCheckbox, simulateCustomDropdown } from "./inputSimulator";

/** Escape a string for use in a CSS attribute selector. */
const cssEscape = typeof CSS !== "undefined" && CSS.escape
  ? (s: string) => CSS.escape(s)
  : (s: string) => s.replace(/([^\w-])/g, "\\$1");

/** Flat profile data from /api/ext/profile/flat. */
export type FlatProfile = Record<string, string>;

/** Historical override values keyed by field selector. */
export type HistoricalOverrides = Record<string, string>;

export interface FillResult {
  filled: number;
  skipped: number;
  fields: Array<{
    selector: string;
    category: FieldCategory;
    value: string;
    filled: boolean;
    source: "profile" | "historical" | "skipped";
  }>;
}

/** Minimum confidence threshold to auto-fill. */
const MIN_CONFIDENCE = 0.15;

/**
 * Fill detected form fields with profile data, with optional historical overrides.
 * Priority: historical override > profile value.
 */
export function fillFields(
  fields: DetectedField[],
  profile: FlatProfile,
  historicalOverrides?: HistoricalOverrides,
): FillResult {
  const result: FillResult = { filled: 0, skipped: 0, fields: [] };

  for (const field of fields) {
    // Skip file upload fields
    if (field.inputType === "file") {
      result.skipped++;
      result.fields.push({
        selector: field.selector,
        category: field.category,
        value: "",
        filled: false,
        source: "skipped",
      });
      continue;
    }

    // Check historical override first
    const historicalValue = historicalOverrides?.[field.selector];
    if (historicalValue) {
      const filled = fillSingleField(field, historicalValue);
      result.fields.push({
        selector: field.selector,
        category: field.category,
        value: historicalValue,
        filled,
        source: "historical",
      });
      if (filled) result.filled++;
      else result.skipped++;
      continue;
    }

    // Fall back to profile value
    const profileKey = PROFILE_KEY_MAP[field.category];
    const value = profileKey ? (profile[profileKey] ?? "") : "";

    if (!value || field.confidence < MIN_CONFIDENCE || field.category === FieldCategory.UNKNOWN) {
      result.skipped++;
      result.fields.push({
        selector: field.selector,
        category: field.category,
        value: "",
        filled: false,
        source: "skipped",
      });
      continue;
    }

    const filled = fillSingleField(field, value);
    result.fields.push({
      selector: field.selector,
      category: field.category,
      value,
      filled,
      source: "profile",
    });
    if (filled) result.filled++;
    else result.skipped++;
  }

  return result;
}

/** Fill a single field based on its element type. */
function fillSingleField(field: DetectedField, value: string): boolean {
  // Re-query the element by selector to handle stale references (SPA re-renders).
  // querySelector throws a SyntaxError for invalid selectors (e.g. from exotic ATS field names).
  let queried: HTMLElement | null = null;
  if (field.selector) {
    try {
      queried = document.querySelector<HTMLElement>(field.selector);
    } catch {
      // Invalid CSS selector — fall through to field.element reference
    }
  }
  const el = (queried ?? field.element) as HTMLElement;

  // Skip disabled or aria-disabled fields
  if (
    (el as HTMLInputElement).disabled ||
    el.getAttribute("aria-disabled") === "true"
  ) {
    return false;
  }
  // Skip truly readonly fields, but allow readonly inputs in dropdown components
  if ((el as HTMLInputElement).readOnly) {
    const role = el.getAttribute("role");
    const parentRole = el.parentElement?.getAttribute("role");
    if (role !== "combobox" && role !== "listbox" && parentRole !== "combobox" && parentRole !== "listbox") {
      return false;
    }
  }

  // Custom dropdown (React/Vue combobox) — check element AND parent containers.
  // Form detector finds <input> elements, but the combobox role is often on a
  // parent <div>. Walk up to 4 levels to find the dropdown container.
  const dropdownTrigger = findDropdownTrigger(el);
  if (dropdownTrigger) {
    void simulateCustomDropdown(dropdownTrigger, value);
    return true;
  }

  // Select dropdown
  if (el instanceof HTMLSelectElement) {
    return simulateSelect(el, value);
  }

  // Radio button — find sibling radios with same name
  if (el instanceof HTMLInputElement && el.type === "radio") {
    const name = el.name;
    if (!name) return false;
    const form = el.closest("form") ?? el.ownerDocument;
    const radios = Array.from(
      form.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${cssEscape(name)}"]`),
    );
    return simulateRadio(radios, value);
  }

  // Checkbox — treat value as boolean-ish ("true", "yes", "1" → check)
  if (el instanceof HTMLInputElement && el.type === "checkbox") {
    const shouldCheck = ["true", "yes", "1", "on"].includes(value.toLowerCase().trim());
    simulateCheckbox(el, shouldCheck);
    return true;
  }

  // Standard text/email/tel/textarea/contenteditable
  simulateInput(el, value);
  return true;
}

/**
 * Check if an element is (or lives inside) a custom dropdown component.
 * Returns the dropdown trigger element, or null for regular inputs.
 *
 * CONSERVATIVE: only match on strong ARIA/data indicators, NOT class names.
 * Class-based heuristics (cls.includes("dropdown")) caused false positives
 * where regular text inputs inside wrappers with "dropdown" in the class
 * were treated as dropdowns, leading to simulateCustomDropdown clicking
 * random options from other dropdowns on the page.
 */
function findDropdownTrigger(el: HTMLElement): HTMLElement | null {
  // 1. Direct check: element itself has explicit dropdown indicators
  if (
    el.getAttribute("role") === "combobox" ||
    el.getAttribute("role") === "listbox" ||
    el.getAttribute("aria-haspopup") === "listbox" ||
    el.dataset?.automationId?.includes("Dropdown")
  ) {
    return el;
  }

  // 2. For standard text inputs with explicit ARIA dropdown attributes → return as trigger
  if (el instanceof HTMLInputElement) {
    if (
      el.getAttribute("aria-expanded") !== null ||
      el.getAttribute("aria-haspopup") === "listbox" ||
      el.getAttribute("aria-autocomplete") !== null
    ) {
      return el; // Searchable combobox input
    }
  }

  // 3. Walk up to find a dropdown container (works for ALL element types including
  //    text inputs that live inside a role="combobox" parent — e.g. React Select)
  let parent = el.parentElement;
  for (let i = 0; i < 4 && parent; i++) {
    if (
      parent.getAttribute("role") === "combobox" ||
      parent.getAttribute("role") === "listbox" ||
      parent.getAttribute("aria-haspopup") === "listbox" ||
      parent.dataset?.automationId?.includes("Dropdown")
    ) {
      return parent;
    }
    parent = parent.parentElement;
  }

  return null;
}

/**
 * Detect and click "Next" / "Continue" buttons in multi-step forms.
 * Returns true if a next-step button was found and clicked.
 */
export function advanceMultiStepForm(doc: Document): boolean {
  const nextButtonSelectors = [
    'button[data-automation-id="bottom-navigation-next-button"]',
    'button[data-testid="next-button"]',
    'button[type="button"]',
    'a.btn',
    'button',
  ];

  const NEXT_PATTERNS = /^(next|continue|proceed|save\s*(?:&|and)\s*continue|save\s*&\s*next|下一步|继续|保存并继续)$/i;
  const SUBMIT_PATTERNS = /^(submit|apply|投递|提交申请|submit\s*application|apply\s*now)$/i;

  for (const selector of nextButtonSelectors) {
    const buttons = doc.querySelectorAll<HTMLElement>(selector);
    for (const btn of buttons) {
      const text = btn.textContent?.trim() ?? "";
      if (SUBMIT_PATTERNS.test(text)) {
        // Reached submit button — stop and let user review
        return false;
      }
      if (NEXT_PATTERNS.test(text)) {
        btn.click();
        return true;
      }
    }
  }

  return false;
}

/**
 * Highlight unfilled form fields on the page with a visual indicator.
 * Adds a pulsing orange outline to fields that were skipped or have no value.
 */
export function highlightUnfilledFields(fields: DetectedField[]): () => void {
  const HIGHLIGHT_CLASS = "joblit-unfilled-highlight";
  const styleId = "joblit-highlight-style";

  // Inject highlight CSS if not already present
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      .${HIGHLIGHT_CLASS} {
        box-shadow: 0 0 0 2px #f59e0b, 0 0 0 4px rgba(245, 158, 11, 0.15) !important;
        background-color: rgba(245, 158, 11, 0.03) !important;
        transition: all 0.3s ease !important;
        animation: joblit-pulse 2s ease-in-out infinite !important;
      }
      .${HIGHLIGHT_CLASS}:focus {
        box-shadow: 0 0 0 2px #22c55e, 0 0 0 4px rgba(34, 197, 94, 0.15) !important;
        background-color: rgba(34, 197, 94, 0.03) !important;
        animation: none !important;
      }
      @keyframes joblit-pulse {
        0%, 100% { box-shadow: 0 0 0 2px #f59e0b, 0 0 0 4px rgba(245, 158, 11, 0.15); }
        50% { box-shadow: 0 0 0 2px #fbbf24, 0 0 0 6px rgba(251, 191, 36, 0.08); }
      }
    `;
    document.head.appendChild(style);
  }

  const highlighted: HTMLElement[] = [];

  for (const field of fields) {
    // Re-query element by selector — guard against invalid CSS selectors
    let el: HTMLElement | null = null;
    if (field.selector) {
      try {
        el = document.querySelector<HTMLElement>(field.selector);
      } catch {
        // Invalid selector — skip this field
      }
    }
    if (!el) continue;

    // Check if field is empty
    const value = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
      ? el.value
      : el instanceof HTMLSelectElement
        ? el.value
        : el.textContent ?? "";

    if (!value.trim()) {
      el.classList.add(HIGHLIGHT_CLASS);
      highlighted.push(el);
    }
  }

  // Return cleanup function to remove highlights
  return () => {
    for (const el of highlighted) {
      el.classList.remove(HIGHLIGHT_CLASS);
    }
    const style = document.getElementById(styleId);
    if (style) style.remove();
  };
}
