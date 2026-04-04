import type { AtsAdapter } from "./types";
import type { DetectedField } from "@ext/shared/types";
import { classifyField, buildSelector, getInputType } from "../fieldClassifier";

/** iCIMS ATS adapter. */
export const icimsAdapter: AtsAdapter = {
  name: "icims",

  canHandle(url: string, doc: Document): boolean {
    // iCIMS hosted pages use icims.com or have iCIMS meta tags
    if (/icims\.com|\.icims\./i.test(url)) return true;
    const meta = doc.querySelector('meta[name="generator"][content*="iCIMS"]');
    return !!meta;
  },

  detectFields(doc: Document): DetectedField[] {
    // iCIMS uses .iCIMS_Forms or form with class containing iCIMS
    const form =
      doc.querySelector<HTMLElement>(".iCIMS_Forms") ??
      doc.querySelector<HTMLElement>('[class*="iCIMS"]') ??
      doc.querySelector<HTMLFormElement>('form[action*="icims"]');

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
