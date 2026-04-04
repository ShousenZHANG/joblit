import type { AtsAdapter } from "./types";
import type { DetectedField } from "@ext/shared/types";
import { classifyField, buildSelector, getInputType } from "../fieldClassifier";

/** Lever ATS adapter. */
export const leverAdapter: AtsAdapter = {
  name: "lever",

  canHandle(url: string): boolean {
    return /jobs\.lever\.co/i.test(url);
  },

  detectFields(doc: Document): DetectedField[] {
    // Lever uses .application-form or form with data-qa="application-form"
    const form =
      doc.querySelector<HTMLFormElement>('[data-qa="application-form"]') ??
      doc.querySelector<HTMLFormElement>(".application-form") ??
      doc.querySelector<HTMLFormElement>(".postings-btn-wrapper")?.closest("form");

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
