import type { AtsAdapter } from "./types";
import type { DetectedField } from "@ext/shared/types";
import { classifyField, buildSelector, getInputType } from "../fieldClassifier";

/** Greenhouse ATS adapter. */
export const greenhouseAdapter: AtsAdapter = {
  name: "greenhouse",

  canHandle(url: string, _doc: Document): boolean {
    return /boards\.greenhouse\.io|\.greenhouse\.io\/.*\/jobs/i.test(url);
  },

  detectFields(doc: Document): DetectedField[] {
    // Greenhouse uses #application_form or .application-form
    const form =
      doc.getElementById("application_form") ??
      doc.querySelector(".application-form");

    if (!form) return []; // Fall back to generic

    const inputs = form.querySelectorAll<HTMLElement>(
      "input:not([type=hidden]):not([type=submit]), textarea, select",
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
