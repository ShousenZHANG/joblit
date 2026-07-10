import { afterEach, describe, it, expect, beforeEach, vi } from "vitest";
import { FieldCategory } from "@ext/shared/fieldTaxonomy";
import type { DetectedField } from "@ext/shared/types";
import {
  buildFieldMappings,
  captureFieldSnapshot,
  extractDomain,
  interceptFormSubmits,
  recordSubmission,
} from "./submissionRecorder";

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

  it("keeps email while excluding sensitive values independently", () => {
    document.body.innerHTML = `
      <input id="email" name="email" type="email" value="john@example.com" />
      <input id="password" name="password" type="password" value="secret" />
      <input id="otp" name="otp" value="123456" />
      <input id="card" name="creditCardNumber" value="4111111111111111" />
      <input id="bank" name="routingNumber" value="012345" />
      <input id="government-id" name="nationalId" value="ID-123" />
    `;
    const fields = Array.from(document.querySelectorAll<HTMLElement>("input"))
      .map((element) => makeField(element, { name: element.getAttribute("name") ?? "" }));

    expect(captureFieldSnapshot(fields)).toEqual({ email: "john@example.com" });
  });

  it("filters lowercase compact sensitive values without dropping employment verification email", () => {
    document.body.innerHTML = `
      <input id="email" name="email" value="john@example.com" />
      <input id="employment-contact" name="employmentverificationemail"
        aria-label="Employment verification contact email" value="hr@example.com" />
      <input id="payment" name="cardnumber" value="4111111111111111" />
      <input id="bank" name="bankaccountnumber" value="012345" />
      <input id="passport" name="passportnumber" value="N1234567" />
      <input id="tax" name="taxfilenumber" value="123456789" />
    `;
    const fields = Array.from(document.querySelectorAll<HTMLElement>("input"))
      .map((element) => makeField(element, { name: element.getAttribute("name") ?? "" }));

    expect(captureFieldSnapshot(fields)).toEqual({
      email: "john@example.com",
      employmentverificationemail: "hr@example.com",
    });
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

  it("excludes sensitive fields independently of detector output", () => {
    document.body.innerHTML = `
      <input id="email" name="email" type="email" />
      <input id="security-code" name="securityCode" />
    `;
    const fields = Array.from(document.querySelectorAll<HTMLElement>("input"))
      .map((element) => makeField(element, { name: element.getAttribute("name") ?? "" }));

    expect(Object.keys(buildFieldMappings(fields))).toEqual(["email"]);
  });

  it("filters lowercase compact sensitive mappings without dropping employment verification email", () => {
    document.body.innerHTML = `
      <input id="email" name="email" />
      <input id="employment-contact" name="employmentverificationemail"
        aria-label="Employment verification contact email" />
      <input id="payment" name="debitcardnumber" />
      <input id="government-id" name="governmentid" />
      <input id="licence" name="driverlicense" />
    `;
    const fields = Array.from(document.querySelectorAll<HTMLElement>("input"))
      .map((element) => makeField(element, { name: element.getAttribute("name") ?? "" }));

    expect(Object.keys(buildFieldMappings(fields))).toEqual([
      "email",
      "employmentverificationemail",
    ]);
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

describe("submission context gating", () => {
  beforeEach(() => {
    document.body.innerHTML = '<form><input id="email" name="email" value="john@example.com" /></form>';
    window.history.replaceState({}, "", "/login");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({}, "", "/");
  });

  it("recordSubmission does not send outside a job application context", async () => {
    const sendMessage = vi.spyOn(chrome.runtime, "sendMessage");
    const field = makeField(document.querySelector("input")!, { name: "email" });

    await recordSubmission([field], "generic");

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("interceptFormSubmits installs no submit listener outside job context", () => {
    const form = document.querySelector("form")!;
    const addEventListener = vi.spyOn(form, "addEventListener");
    const field = makeField(document.querySelector("input")!, { name: "email" });

    const cleanup = interceptFormSubmits([field], "generic");

    expect(addEventListener).not.toHaveBeenCalledWith("submit", expect.any(Function));
    expect(() => cleanup()).not.toThrow();
  });
});
