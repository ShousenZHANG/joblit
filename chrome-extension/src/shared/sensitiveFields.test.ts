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
});
