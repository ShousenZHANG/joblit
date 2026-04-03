import type { DetectedField } from "@ext/shared/types";
import { FieldCategory, PROFILE_KEY_MAP } from "@ext/shared/fieldTaxonomy";
import { simulateInput, simulateSelect } from "./inputSimulator";

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

    if (field.element instanceof HTMLSelectElement) {
      const success = simulateSelect(field.element, value);
      result.fields.push({
        selector: field.selector,
        category: field.category,
        value,
        filled: success,
      });
      if (success) result.filled++;
      else result.skipped++;
    } else {
      simulateInput(field.element, value);
      result.filled++;
      result.fields.push({
        selector: field.selector,
        category: field.category,
        value,
        filled: true,
      });
    }
  }

  return result;
}
