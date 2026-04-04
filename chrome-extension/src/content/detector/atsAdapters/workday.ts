import type { AtsAdapter } from "./types";
import type { DetectedField } from "@ext/shared/types";
import { classifyField, buildSelector, getInputType } from "../fieldClassifier";

/** Workday ATS adapter. */
export const workdayAdapter: AtsAdapter = {
  name: "workday",

  canHandle(url: string, _doc: Document): boolean {
    return /myworkdayjobs\.com|\.wd[0-9]+\.myworkdayjobs\.com|workday\.com\/.*\/job/i.test(url);
  },

  detectFields(doc: Document): DetectedField[] {
    // Workday renders forms inside [data-automation-id] containers
    const formContainer =
      doc.querySelector<HTMLElement>('[data-automation-id="jobApplicationContainer"]') ??
      doc.querySelector<HTMLElement>('[data-automation-id="applyForm"]') ??
      doc.querySelector<HTMLElement>(".css-1bfq2lx"); // common Workday form wrapper class

    if (!formContainer) return [];

    // Workday uses custom components — query both standard inputs and Workday-specific elements
    const inputs = formContainer.querySelectorAll<HTMLElement>(
      [
        "input:not([type=hidden]):not([type=submit]):not([type=button])",
        "textarea",
        "select",
        '[data-automation-id$="Input"]',
        '[data-automation-id$="Dropdown"]',
        '[role="combobox"]',
        '[role="listbox"]',
      ].join(", "),
    );

    // Deduplicate — Workday may match both a native input and its wrapper
    const seen = new Set<HTMLElement>();
    const fields: DetectedField[] = [];

    for (const el of inputs) {
      // If this is a wrapper, look for the actual input inside
      const target =
        el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT"
          ? el
          : el.querySelector<HTMLElement>("input, textarea, select") ?? el;

      if (seen.has(target)) continue;
      seen.add(target);

      const inputType = getInputType(target);
      const { category, confidence, labelText } = classifyField(target);

      fields.push({
        element: target,
        selector: buildSelector(target),
        inputType,
        category,
        confidence,
        labelText,
        name: target.getAttribute("name") ?? "",
        id: target.id ?? "",
        placeholder: (target as HTMLInputElement).placeholder ?? "",
      });
    }

    return fields;
  },
};
