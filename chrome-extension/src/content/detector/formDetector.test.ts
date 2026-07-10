import { describe, it, expect, beforeEach } from "vitest";
import { FieldCategory } from "@ext/shared/fieldTaxonomy";
import type { DetectedField } from "@ext/shared/types";
import type { AtsAdapter } from "./atsAdapters/types";
import { detectFields, detectForms } from "./formDetector";

describe("detectForms", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("detects basic form fields", () => {
    document.body.innerHTML = `
      <form>
        <label for="name">Full Name</label>
        <input id="name" name="name" type="text" />
        <label for="email">Email</label>
        <input id="email" name="email" type="email" />
        <label for="phone">Phone</label>
        <input id="phone" name="phone" type="tel" />
        <button type="submit">Submit</button>
      </form>
    `;

    const result = detectForms(document);
    expect(result.atsProvider).toBe("generic");
    expect(result.forms).toHaveLength(1);
    expect(result.fields.length).toBeGreaterThanOrEqual(3);

    const categories = result.fields.map((f) => f.category);
    expect(categories).toContain(FieldCategory.FULL_NAME);
    expect(categories).toContain(FieldCategory.EMAIL);
    expect(categories).toContain(FieldCategory.PHONE);
  });

  it("skips hidden and submit inputs", () => {
    document.body.innerHTML = `
      <form>
        <input type="hidden" name="csrf" value="abc" />
        <input type="submit" value="Apply" />
        <input name="email" type="email" />
      </form>
    `;

    const result = detectForms(document);
    expect(result.fields).toHaveLength(1);
    expect(result.fields[0].inputType).toBe("email");
  });

  it("handles pages with no forms", () => {
    document.body.innerHTML = `<div>No forms here</div>`;
    const result = detectForms(document);
    expect(result.fields).toHaveLength(0);
    expect(result.forms).toHaveLength(0);
  });

  it("detects textarea and select elements", () => {
    document.body.innerHTML = `
      <form>
        <label for="cover">Cover Letter</label>
        <textarea id="cover" name="cover_letter"></textarea>
        <label for="country">Country</label>
        <select id="country" name="country">
          <option>USA</option>
          <option>Australia</option>
        </select>
      </form>
    `;

    const result = detectForms(document);
    const types = result.fields.map((f) => f.inputType);
    expect(types).toContain("textarea");
    expect(types).toContain("select");
  });

  it("includes field metadata (selector, name, id)", () => {
    document.body.innerHTML = `
      <form>
        <input id="test-field" name="first_name" placeholder="Enter first name" />
      </form>
    `;

    const result = detectForms(document);
    const field = result.fields[0];
    expect(field.selector).toBe("#test-field");
    expect(field.name).toBe("first_name");
    expect(field.id).toBe("test-field");
    expect(field.placeholder).toBe("Enter first name");
  });

  it("keeps email while excluding sensitive generic fields", () => {
    document.body.innerHTML = `
      <form>
        <label for="email">Email</label>
        <input id="email" name="email" type="email" />
        <input id="password" name="password" type="password" />
        <input id="otp" name="otp" />
        <input id="payment" name="creditCardNumber" />
        <input id="bank" name="bankAccountNumber" />
        <label for="passport">Passport number</label>
        <input id="passport" />
      </form>
    `;

    const result = detectForms(document);
    expect(result.fields.map((field) => field.id)).toEqual(["email"]);
  });

  it("filters sensitive fields returned by an ATS adapter", () => {
    document.body.innerHTML = `
      <input id="email" type="email" />
      <input id="verification" aria-label="Verification code" />
    `;
    const elements = Array.from(document.querySelectorAll<HTMLElement>("input"));
    const adapterFields: DetectedField[] = elements.map((element) => ({
      element,
      selector: `#${element.id}`,
      inputType: element.getAttribute("type") ?? "text",
      category: FieldCategory.UNKNOWN,
      confidence: 0,
      labelText: element.getAttribute("aria-label") ?? "",
      name: "",
      id: element.id,
      placeholder: "",
    }));
    const adapter: AtsAdapter = {
      name: "test-ats",
      canHandle: () => true,
      detectFields: () => adapterFields,
    };

    expect(detectFields(document, adapter).map((field) => field.id)).toEqual([
      "email",
    ]);
  });
});

describe("detectForms — shadow DOM coverage", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("detects inputs inside an open shadow root", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<input id="sd-email" type="email" name="email" />`;

    const result = detectForms(document);
    const emailField = result.fields.find((f) => f.category === FieldCategory.EMAIL);
    expect(emailField).toBeDefined();
    // The element reference is kept so the filler can still target it even
    // though a light-DOM querySelector can't reach into the shadow root.
    expect(emailField?.element).toBe(shadow.querySelector("#sd-email"));
  });

  it("detects inputs nested in shadow roots within shadow roots", () => {
    const outer = document.createElement("div");
    document.body.appendChild(outer);
    const outerShadow = outer.attachShadow({ mode: "open" });
    const inner = document.createElement("div");
    outerShadow.appendChild(inner);
    const innerShadow = inner.attachShadow({ mode: "open" });
    innerShadow.innerHTML = `<input id="deep" autocomplete="tel" />`;

    const result = detectForms(document);
    expect(result.fields.some((f) => f.category === FieldCategory.PHONE)).toBe(true);
  });
});
