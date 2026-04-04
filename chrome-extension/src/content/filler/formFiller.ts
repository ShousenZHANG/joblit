import type { DetectedField } from "@ext/shared/types";
import { FieldCategory, PROFILE_KEY_MAP } from "@ext/shared/fieldTaxonomy";
import { simulateInput, simulateSelect, simulateRadio, simulateCheckbox } from "./inputSimulator";

/** Flat profile data from /api/ext/profile/flat. */
export type FlatProfile = Record<string, string>;

export interface FillResult {
  filled: number;
  skipped: number;
  fields: Array<{
    selector: string;
    category: FieldCategory;
    value: string;
    filled: boolean;
  }>;
}

/** Minimum confidence threshold to auto-fill. */
const MIN_CONFIDENCE = 0.15;

/** Fill detected form fields with profile data. */
export function fillFields(
  fields: DetectedField[],
  profile: FlatProfile,
): FillResult {
  const result: FillResult = { filled: 0, skipped: 0, fields: [] };

  for (const field of fields) {
    const profileKey = PROFILE_KEY_MAP[field.category];
    const value = profileKey ? (profile[profileKey] ?? "") : "";

    if (!value || field.confidence < MIN_CONFIDENCE || field.category === FieldCategory.UNKNOWN) {
      result.skipped++;
      result.fields.push({
        selector: field.selector,
        category: field.category,
        value: "",
        filled: false,
      });
      continue;
    }

    // Skip file upload fields
    if (field.inputType === "file") {
      result.skipped++;
      result.fields.push({
        selector: field.selector,
        category: field.category,
        value: "",
        filled: false,
      });
      continue;
    }

    const filled = fillSingleField(field, value);
    result.fields.push({
      selector: field.selector,
      category: field.category,
      value,
      filled,
    });
    if (filled) result.filled++;
    else result.skipped++;
  }

  return result;
}

/** Fill a single field based on its element type. */
function fillSingleField(field: DetectedField, value: string): boolean {
  const el = field.element;

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
      form.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${name}"]`),
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

  const nextPatterns = /^(next|continue|proceed|下一步|继续)$/i;

  for (const selector of nextButtonSelectors) {
    const buttons = doc.querySelectorAll<HTMLElement>(selector);
    for (const btn of buttons) {
      const text = btn.textContent?.trim() ?? "";
      if (nextPatterns.test(text)) {
        btn.click();
        return true;
      }
    }
  }

  return false;
}
