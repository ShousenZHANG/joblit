import { describe, it, expect, beforeEach } from "vitest";
import { FieldCategory } from "@ext/shared/fieldTaxonomy";
import type { DetectedField } from "@ext/shared/types";
import { captureFieldSnapshot, buildFieldMappings, extractDomain } from "./submissionRecorder";

function makeField(el: HTMLElement, overrides: Partial<DetectedField> = {}): DetectedField {
  return {
    element: el,
    selector: `#${el.id}`,
    inputType: "text",
    category: FieldCategory.EMAIL,
    confidence: 0.8,
    labelText: "Email",
    name: el.getAttribute("name") ?? "",
    id: el.id,
    placeholder: "",
    ...overrides,
  };
}

describe("captureFieldSnapshot", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("captures input values", () => {
    document.body.innerHTML = `
      <input id="email" name="email" value="john@example.com" />
      <input id="name" name="name" value="John Doe" />
    `;
    const fields = [
      makeField(document.getElementById("email")!, { name: "email" }),
      makeField(document.getElementById("name")!, { name: "name", category: FieldCategory.FULL_NAME }),
    ];

    const snapshot = captureFieldSnapshot(fields);
    expect(snapshot.email).toBe("john@example.com");
    expect(snapshot.name).toBe("John Doe");
  });

  it("captures textarea values", () => {
    document.body.innerHTML = `<textarea id="cover" name="cover">My cover letter</textarea>`;
    const el = document.getElementById("cover") as HTMLTextAreaElement;
    const fields = [makeField(el, { name: "cover", inputType: "textarea" })];

    const snapshot = captureFieldSnapshot(fields);
    expect(snapshot.cover).toBe("My cover letter");
  });

  it("captures select values", () => {
    document.body.innerHTML = `
      <select id="country" name="country">
        <option value="AU" selected>Australia</option>
      </select>
    `;
    const el = document.getElementById("country") as HTMLSelectElement;
    const fields = [makeField(el, { name: "country", inputType: "select" })];

    const snapshot = captureFieldSnapshot(fields);
    expect(snapshot.country).toBe("AU");
  });

  it("uses id as fallback key when no name", () => {
    document.body.innerHTML = `<input id="myfield" value="test" />`;
    const el = document.getElementById("myfield")!;
    const fields = [makeField(el, { name: "" })];

    const snapshot = captureFieldSnapshot(fields);
    expect(snapshot.myfield).toBe("test");
  });
});

describe("buildFieldMappings", () => {
  it("builds mapping metadata from fields", () => {
    document.body.innerHTML = `<input id="email" name="email" />`;
    const el = document.getElementById("email")!;
    const fields = [
      makeField(el, { name: "email", category: FieldCategory.EMAIL, confidence: 0.9 }),
    ];

    const mappings = buildFieldMappings(fields);
    expect(mappings.email).toEqual({
      source: "profile",
      profilePath: "email",
      confidence: 0.9,
    });
  });

  it("marks zero-confidence fields as manual", () => {
    document.body.innerHTML = `<input id="custom" name="custom" />`;
    const el = document.getElementById("custom")!;
    const fields = [
      makeField(el, { name: "custom", category: FieldCategory.UNKNOWN, confidence: 0 }),
    ];

    const mappings = buildFieldMappings(fields);
    expect(mappings.custom.source).toBe("manual");
  });
});

describe("extractDomain", () => {
  it("extracts hostname from URL", () => {
    expect(extractDomain("https://boards.greenhouse.io/acme/jobs/123")).toBe("boards.greenhouse.io");
    expect(extractDomain("https://jobs.lever.co/company")).toBe("jobs.lever.co");
  });

  it("returns empty for invalid URL", () => {
    expect(extractDomain("not a url")).toBe("");
  });
});
