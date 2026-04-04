import { describe, it, expect, beforeEach } from "vitest";
import { FieldCategory } from "@ext/shared/fieldTaxonomy";
import type { DetectedField } from "@ext/shared/types";
import { fillFields, advanceMultiStepForm, type FlatProfile } from "./formFiller";

const sampleProfile: FlatProfile = {
  fullName: "John Doe",
  firstName: "John",
  lastName: "Doe",
  email: "john@example.com",
  phone: "+61 400 000 000",
  location: "Sydney, Australia",
  currentTitle: "Senior Engineer",
  linkedinUrl: "https://linkedin.com/in/johndoe",
  githubUrl: "https://github.com/johndoe",
  currentCompany: "TechCorp",
  schoolName: "University of Sydney",
  degree: "BSc Computer Science",
  skills: "TypeScript, React, Node.js",
};

function makeField(
  overrides: Partial<DetectedField> & { element: HTMLElement },
): DetectedField {
  return {
    selector: "#test",
    inputType: "text",
    category: FieldCategory.UNKNOWN,
    confidence: 0.5,
    labelText: "",
    name: "",
    id: "",
    placeholder: "",
    ...overrides,
  };
}

describe("fillFields", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("fills text inputs with matching profile data", () => {
    document.body.innerHTML = `
      <input id="name" />
      <input id="email" />
    `;
    const nameEl = document.getElementById("name") as HTMLInputElement;
    const emailEl = document.getElementById("email") as HTMLInputElement;

    const fields: DetectedField[] = [
      makeField({ element: nameEl, category: FieldCategory.FULL_NAME, confidence: 0.5 }),
      makeField({ element: emailEl, category: FieldCategory.EMAIL, confidence: 0.5 }),
    ];

    const result = fillFields(fields, sampleProfile);
    expect(result.filled).toBe(2);
    expect(nameEl.value).toBe("John Doe");
    expect(emailEl.value).toBe("john@example.com");
  });

  it("skips fields with low confidence", () => {
    document.body.innerHTML = `<input id="x" />`;
    const el = document.getElementById("x") as HTMLInputElement;

    const fields: DetectedField[] = [
      makeField({ element: el, category: FieldCategory.EMAIL, confidence: 0.05 }),
    ];

    const result = fillFields(fields, sampleProfile);
    expect(result.filled).toBe(0);
    expect(result.skipped).toBe(1);
    expect(el.value).toBe("");
  });

  it("skips UNKNOWN category fields", () => {
    document.body.innerHTML = `<input id="x" />`;
    const el = document.getElementById("x") as HTMLInputElement;

    const fields: DetectedField[] = [
      makeField({ element: el, category: FieldCategory.UNKNOWN, confidence: 1.0 }),
    ];

    const result = fillFields(fields, sampleProfile);
    expect(result.filled).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("skips fields with no matching profile value", () => {
    document.body.innerHTML = `<input id="x" />`;
    const el = document.getElementById("x") as HTMLInputElement;

    const fields: DetectedField[] = [
      makeField({ element: el, category: FieldCategory.DESIRED_SALARY, confidence: 0.5 }),
    ];

    const result = fillFields(fields, sampleProfile);
    expect(result.skipped).toBe(1);
  });

  it("handles select elements", () => {
    document.body.innerHTML = `
      <select id="country">
        <option value="">Select...</option>
        <option value="AU">Australia</option>
      </select>
    `;
    const el = document.getElementById("country") as HTMLSelectElement;

    const fields: DetectedField[] = [
      makeField({
        element: el,
        category: FieldCategory.LOCATION,
        confidence: 0.5,
        inputType: "select",
      }),
    ];

    // location = "Sydney, Australia" won't match exactly, so select fails
    const result = fillFields(fields, sampleProfile);
    // The select won't find "Sydney, Australia" as an exact option
    expect(result.fields[0].filled).toBe(false);
  });

  it("returns detailed field results", () => {
    document.body.innerHTML = `<input id="a" /><input id="b" />`;
    const a = document.getElementById("a") as HTMLInputElement;
    const b = document.getElementById("b") as HTMLInputElement;

    const fields: DetectedField[] = [
      makeField({ element: a, category: FieldCategory.EMAIL, confidence: 0.8, selector: "#a" }),
      makeField({ element: b, category: FieldCategory.UNKNOWN, confidence: 0, selector: "#b" }),
    ];

    const result = fillFields(fields, sampleProfile);
    expect(result.fields).toHaveLength(2);
    expect(result.fields[0]).toMatchObject({
      selector: "#a",
      category: FieldCategory.EMAIL,
      filled: true,
      value: "john@example.com",
    });
    expect(result.fields[1]).toMatchObject({
      selector: "#b",
      category: FieldCategory.UNKNOWN,
      filled: false,
    });
  });

  it("skips file inputs", () => {
    document.body.innerHTML = `<input id="resume" type="file" />`;
    const el = document.getElementById("resume") as HTMLInputElement;

    const fields: DetectedField[] = [
      makeField({
        element: el,
        category: FieldCategory.RESUME_UPLOAD,
        confidence: 0.5,
        inputType: "file",
      }),
    ];

    const result = fillFields(fields, sampleProfile);
    expect(result.skipped).toBe(1);
  });

  it("fills radio button groups", () => {
    document.body.innerHTML = `
      <form>
        <input type="radio" name="gender" value="male" />
        <input type="radio" name="gender" value="female" />
      </form>
    `;
    const radios = document.querySelectorAll<HTMLInputElement>('input[name="gender"]');
    const profileWithGender: FlatProfile = { ...sampleProfile, gender: "male" };

    const fields: DetectedField[] = [
      makeField({
        element: radios[0],
        category: FieldCategory.GENDER,
        confidence: 0.5,
        inputType: "radio",
      }),
    ];

    const result = fillFields(fields, profileWithGender);
    expect(result.filled).toBe(1);
    expect(radios[0].checked).toBe(true);
  });

  it("fills checkbox fields", () => {
    document.body.innerHTML = `<input id="terms" type="checkbox" />`;
    const el = document.getElementById("terms") as HTMLInputElement;
    const profileWithTerms: FlatProfile = { ...sampleProfile, agreeTerms: "yes" };

    const fields: DetectedField[] = [
      makeField({
        element: el,
        category: FieldCategory.AGREE_TERMS,
        confidence: 0.5,
        inputType: "checkbox",
      }),
    ];

    const result = fillFields(fields, profileWithTerms);
    expect(result.filled).toBe(1);
    expect(el.checked).toBe(true);
  });
});

describe("advanceMultiStepForm", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("clicks a Next button", () => {
    let clicked = false;
    document.body.innerHTML = `<button type="button">Next</button>`;
    document.querySelector("button")!.addEventListener("click", () => { clicked = true; });
    expect(advanceMultiStepForm(document)).toBe(true);
    expect(clicked).toBe(true);
  });

  it("clicks a Continue button", () => {
    let clicked = false;
    document.body.innerHTML = `<button type="button">Continue</button>`;
    document.querySelector("button")!.addEventListener("click", () => { clicked = true; });
    expect(advanceMultiStepForm(document)).toBe(true);
  });

  it("returns false when no next button found", () => {
    document.body.innerHTML = `<button type="submit">Submit</button>`;
    expect(advanceMultiStepForm(document)).toBe(false);
  });
});
