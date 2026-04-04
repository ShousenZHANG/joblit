import type { AtsAdapter } from "./types";
import type { DetectedField } from "@ext/shared/types";
import { classifyField, buildSelector, getInputType } from "../fieldClassifier";

/** SAP SuccessFactors ATS adapter. */
export const successFactorsAdapter: AtsAdapter = {
  name: "successfactors",

  canHandle(url: string, _doc: Document): boolean {
    return /successfactors\.com|\.successfactors\.|sap\.com\/.*career/i.test(url);
  },

  detectFields(doc: Document): DetectedField[] {
    // SuccessFactors uses data-automation-id patterns or #applyFormContainer
    const form =
      doc.querySelector<HTMLElement>("#applyFormContainer") ??
      doc.querySelector<HTMLElement>('[data-automation-id="applyForm"]') ??
      doc.querySelector<HTMLFormElement>('form[name="applyForm"]');

    if (!form) return [];

    const inputs = form.querySelectorAll<HTMLElement>(
      "input:not([type=hidden]):not([type=submit]):not([type=button]), textarea, select",
    );

    const fields: DetectedField[] = [];
    for (const el of inputs) {
      const inputType = getInputType(el);
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
  },
};
