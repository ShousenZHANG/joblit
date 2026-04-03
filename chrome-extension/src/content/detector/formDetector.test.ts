import { describe, it, expect, beforeEach } from "vitest";
import { FieldCategory } from "@ext/shared/fieldTaxonomy";
import { detectForms } from "./formDetector";

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
});
