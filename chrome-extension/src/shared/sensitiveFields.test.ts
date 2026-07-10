import { beforeEach, describe, expect, it } from "vitest";
import { FieldCategory } from "./fieldTaxonomy";
import type { DetectedField } from "./types";
import { filterSafeFields, isSensitiveField } from "./sensitiveFields";

function asDetectedField(element: HTMLElement): DetectedField {
  return {
    element,
    selector: element.id ? `#${element.id}` : element.tagName.toLowerCase(),
    inputType: element.getAttribute("type") ?? "text",
    category: FieldCategory.UNKNOWN,
    confidence: 0,
    labelText: "",
    name: element.getAttribute("name") ?? "",
    id: element.id,
    placeholder: element.getAttribute("placeholder") ?? "",
  };
}

describe("isSensitiveField", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it.each([
    '<input id="password" type="password" />',
    '<input id="otp" autocomplete="one-time-code" />',
    '<input id="card" autocomplete="section-checkout cc-number" />',
    '<input id="transaction" autocomplete="transaction-amount" />',
    '<input id="bank" name="bankAccountNumber" />',
    '<input id="passport" aria-label="Passport number" />',
    '<input id="two-factor" aria-label="2FA code" />',
    '<input id="licence" placeholder="Driver\'s licence number" />',
  ])("denies sensitive fields described by supported metadata: %s", (markup) => {
    document.body.innerHTML = markup;
    expect(isSensitiveField(document.querySelector("input")!)).toBe(true);
  });

  it.each([
    "cardnumber",
    "creditcardnumber",
    "debitcardnumber",
    "ccnumber",
    "bankaccount",
    "bankaccountnumber",
    "routingnumber",
    "passportnumber",
    "taxfilenumber",
    "nationalid",
    "nationalidentifier",
    "governmentid",
    "socialsecuritynumber",
    "driverslicence",
    "driverlicense",
    "creditcard",
    "debitcard",
    "cardsecuritycode",
    "cvvcode",
    "cvv2",
    "cvc2",
    "ccnum",
    "cardno",
    "bankroutingnumber",
    "bsbnumber",
    "swiftcode",
    "passportid",
    "passportnum",
    "nationalidnumber",
    "governmentidentifier",
    "driverslicense",
    "driverlicencenumber",
    "securitycode",
    "verificationtoken",
  ])("denies the exact compact sensitive token %s", (token) => {
    document.body.innerHTML = `<input name="${token}" />`;
    expect(isSensitiveField(document.querySelector("input")!)).toBe(true);
  });

  it("denies exact verification metadata and sensitive verification phrases", () => {
    document.body.innerHTML = `
      <input id="exact" name="verification" />
      <input id="code" aria-label="Verification code" />
      <input id="token" placeholder="Enter verification token" />
    `;

    expect(isSensitiveField(document.querySelector("#exact")!)).toBe(true);
    expect(isSensitiveField(document.querySelector("#code")!)).toBe(true);
    expect(isSensitiveField(document.querySelector("#token")!)).toBe(true);
  });

  it("keeps employment verification contact email", () => {
    document.body.innerHTML = `
      <input id="employment-contact" aria-label="Employment verification contact email" />
    `;

    expect(isSensitiveField(document.querySelector("#employment-contact")!)).toBe(false);
  });

  it("does not deny an arbitrary substring containing a compact token", () => {
    document.body.innerHTML = `
      <input id="status" name="candidatecreditcardnumberstatus" />
    `;

    expect(isSensitiveField(document.querySelector("#status")!)).toBe(false);
  });

  it.each([
    "cardinality",
    "candidateaccountmanager",
    "swiftcoder",
    "passportnumbering",
  ])("keeps the anchored compact-family near miss %s", (token) => {
    document.body.innerHTML = `<input name="${token}" />`;
    expect(isSensitiveField(document.querySelector("input")!)).toBe(false);
  });

  it("reads label and aria-describedby text", () => {
    document.body.innerHTML = `
      <label for="security-answer">Security answer</label>
      <input id="security-answer" />
      <p id="tfn-help">Enter your Tax File Number</p>
      <input id="tax-id" aria-describedby="tfn-help" />
    `;

    expect(isSensitiveField(document.querySelector("#security-answer")!)).toBe(true);
    expect(isSensitiveField(document.querySelector("#tax-id")!)).toBe(true);
  });

  it("reads aria-describedby text from an open shadow root by exact id", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <p id="security:help[1]">Enter your security code</p>
      <input id="shadow-field" aria-describedby="security:help[1]" />
    `;

    expect(isSensitiveField(shadow.querySelector("#shadow-field")!)).toBe(true);
  });

  it("keeps ordinary email and shipping fields", () => {
    document.body.innerHTML = `
      <label for="email">Email</label>
      <input id="email" name="email" type="email" />
      <label for="shipping">Shipping address</label>
      <input id="shipping" name="shipping_address" />
    `;

    expect(isSensitiveField(document.querySelector("#email")!)).toBe(false);
    expect(isSensitiveField(document.querySelector("#shipping")!)).toBe(false);
  });
});

describe("filterSafeFields", () => {
  it("returns only non-sensitive detected fields", () => {
    document.body.innerHTML = `
      <input id="email" name="email" type="email" />
      <input id="password" name="password" type="password" />
      <input id="otp" name="otp" />
      <input id="card" name="creditCardNumber" />
      <input id="bank" name="routingNumber" />
      <input id="government-id" name="nationalId" />
    `;
    const fields = Array.from(document.querySelectorAll<HTMLElement>("input"))
      .map(asDetectedField);

    expect(filterSafeFields(fields).map((field) => field.id)).toEqual(["email"]);
  });

  it("filters sensitive cached metadata when the DOM element is neutral", () => {
    document.body.innerHTML = `
      <input id="safe-dom" value="safe" />
      <input id="cached-name-dom" value="secret" />
      <input id="cached-type-dom" value="secret" />
      <input id="cached-id-dom" value="secret" />
      <input id="cached-placeholder-dom" value="secret" />
      <input id="cached-label-dom" value="secret" />
    `;
    const elements = Array.from(document.querySelectorAll<HTMLElement>("input"));
    const fields = [
      asDetectedField(elements[0]),
      { ...asDetectedField(elements[1]), name: "cardnumber" },
      { ...asDetectedField(elements[2]), inputType: "password" },
      { ...asDetectedField(elements[3]), id: "passportnum" },
      { ...asDetectedField(elements[4]), placeholder: "swiftcode" },
      { ...asDetectedField(elements[5]), labelText: "CVC2" },
    ];

    expect(filterSafeFields(fields).map((field) => field.id)).toEqual([
      "safe-dom",
    ]);
  });
});
