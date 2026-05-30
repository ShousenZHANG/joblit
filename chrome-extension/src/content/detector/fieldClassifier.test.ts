import { describe, it, expect, beforeEach } from "vitest";
import { FieldCategory } from "@ext/shared/fieldTaxonomy";
import {
  normalizeText,
  findLabelText,
  findAdjacentText,
  matchScore,
  classifyField,
  buildSelector,
  getInputType,
} from "./fieldClassifier";

describe("normalizeText", () => {
  it("trims whitespace", () => {
    expect(normalizeText("  hello  ")).toBe("hello");
  });

  it("collapses multiple spaces", () => {
    expect(normalizeText("first   name")).toBe("first name");
  });

  it("handles empty string", () => {
    expect(normalizeText("")).toBe("");
  });
});

describe("findLabelText", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("finds label by for attribute", () => {
    document.body.innerHTML = `
      <label for="email-input">Email Address</label>
      <input id="email-input" type="email" />
    `;
    const input = document.getElementById("email-input")!;
    expect(findLabelText(input)).toBe("Email Address");
  });

  it("finds wrapping label", () => {
    document.body.innerHTML = `
      <label>
        Phone Number
        <input type="tel" id="phone" />
      </label>
    `;
    const input = document.getElementById("phone")!;
    expect(findLabelText(input)).toContain("Phone Number");
  });

  it("uses aria-label as fallback", () => {
    document.body.innerHTML = `
      <input aria-label="LinkedIn URL" id="li" />
    `;
    const input = document.getElementById("li")!;
    expect(findLabelText(input)).toBe("LinkedIn URL");
  });

  it("returns empty for unlabeled field", () => {
    document.body.innerHTML = `<input id="mystery" />`;
    const input = document.getElementById("mystery")!;
    expect(findLabelText(input)).toBe("");
  });
});

describe("findAdjacentText", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("finds previous sibling text", () => {
    document.body.innerHTML = `
      <div>
        <span>Full Name</span>
        <input id="name" />
      </div>
    `;
    const input = document.getElementById("name")!;
    expect(findAdjacentText(input)).toBe("Full Name");
  });

  it("finds parent direct text node", () => {
    document.body.innerHTML = `
      <div>
        Email:
        <input id="email" />
      </div>
    `;
    const input = document.getElementById("email")!;
    const text = findAdjacentText(input);
    expect(text).toContain("Email");
  });
});

describe("matchScore", () => {
  it("returns 1.0 for matching pattern", () => {
    expect(matchScore("email", FieldCategory.EMAIL)).toBe(1.0);
    expect(matchScore("Full Name", FieldCategory.FULL_NAME)).toBe(1.0);
  });

  it("returns 0 for non-matching", () => {
    expect(matchScore("foobar", FieldCategory.EMAIL)).toBe(0);
  });

  it("returns 0 for empty text", () => {
    expect(matchScore("", FieldCategory.EMAIL)).toBe(0);
  });

  it("returns 0 for UNKNOWN category", () => {
    expect(matchScore("email", FieldCategory.UNKNOWN)).toBe(0);
  });
});

describe("classifyField", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("classifies an email input by name attribute", () => {
    document.body.innerHTML = `<input name="email" id="test-email" />`;
    const input = document.getElementById("test-email")!;
    const result = classifyField(input);
    expect(result.category).toBe(FieldCategory.EMAIL);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("classifies a phone input by label", () => {
    document.body.innerHTML = `
      <label for="ph">Phone Number</label>
      <input id="ph" />
    `;
    const input = document.getElementById("ph")!;
    const result = classifyField(input);
    expect(result.category).toBe(FieldCategory.PHONE);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("classifies by placeholder", () => {
    document.body.innerHTML = `<input id="fn" placeholder="Your full name" />`;
    const input = document.getElementById("fn")!;
    const result = classifyField(input);
    expect(result.category).toBe(FieldCategory.FULL_NAME);
  });

  it("classifies Chinese labels", () => {
    document.body.innerHTML = `
      <label for="wx">微信</label>
      <input id="wx" />
    `;
    const input = document.getElementById("wx")!;
    const result = classifyField(input);
    expect(result.category).toBe(FieldCategory.WECHAT);
  });

  it("returns UNKNOWN for unrecognizable fields", () => {
    document.body.innerHTML = `<input id="xyz" name="custom_field_42" />`;
    const input = document.getElementById("xyz")!;
    const result = classifyField(input);
    expect(result.category).toBe(FieldCategory.UNKNOWN);
    expect(result.confidence).toBe(0);
  });

  it("combines multiple signals for higher confidence", () => {
    document.body.innerHTML = `
      <label for="email-field">Email Address</label>
      <input id="email-field" name="email" placeholder="Enter your email" />
    `;
    const input = document.getElementById("email-field")!;
    const result = classifyField(input);
    expect(result.category).toBe(FieldCategory.EMAIL);
    // name (0.3) + label (0.35) + placeholder (0.15) = 0.8
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });
});

describe("buildSelector", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("uses #id when available", () => {
    document.body.innerHTML = `<input id="myfield" />`;
    const el = document.getElementById("myfield")!;
    expect(buildSelector(el)).toBe("#myfield");
  });

  it("uses [name] when no id", () => {
    document.body.innerHTML = `<input name="first_name" />`;
    const el = document.querySelector("input")!;
    expect(buildSelector(el)).toBe('[name="first_name"]');
  });

  it("falls back to nth-of-type", () => {
    document.body.innerHTML = `
      <div>
        <input />
        <input class="target" />
      </div>
    `;
    const el = document.querySelector(".target") as HTMLElement;
    expect(buildSelector(el)).toBe("input:nth-of-type(2)");
  });
});

describe("getInputType", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("returns 'select' for select elements", () => {
    document.body.innerHTML = `<select id="s"></select>`;
    expect(getInputType(document.getElementById("s")!)).toBe("select");
  });

  it("returns 'textarea' for textareas", () => {
    document.body.innerHTML = `<textarea id="t"></textarea>`;
    expect(getInputType(document.getElementById("t")!)).toBe("textarea");
  });

  it("returns input type attribute", () => {
    document.body.innerHTML = `<input type="email" id="e" />`;
    expect(getInputType(document.getElementById("e")!)).toBe("email");
  });

  it("defaults to 'text'", () => {
    document.body.innerHTML = `<input id="i" />`;
    expect(getInputType(document.getElementById("i")!)).toBe("text");
  });
});

describe("classifyField — authoritative attribute signals", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("classifies from autocomplete token even when name/label are ambiguous", () => {
    document.body.innerHTML = `<input id="f" name="field_7b" autocomplete="family-name" />`;
    const input = document.getElementById("f")!;
    const result = classifyField(input);
    expect(result.category).toBe(FieldCategory.LAST_NAME);
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("parses scoped/multi-token autocomplete values", () => {
    document.body.innerHTML = `<input id="f" autocomplete="shipping address-level2" />`;
    const input = document.getElementById("f")!;
    expect(classifyField(input).category).toBe(FieldCategory.CITY);
  });

  it("maps organization/organization-title autocomplete", () => {
    document.body.innerHTML = `
      <input id="co" autocomplete="organization" />
      <input id="ti" autocomplete="organization-title" />
    `;
    expect(classifyField(document.getElementById("co")!).category).toBe(
      FieldCategory.CURRENT_COMPANY,
    );
    expect(classifyField(document.getElementById("ti")!).category).toBe(
      FieldCategory.CURRENT_TITLE,
    );
  });

  it("uses type=email / type=tel as a strong hint", () => {
    document.body.innerHTML = `
      <input id="e" type="email" name="contact" />
      <input id="p" type="tel" name="contact2" />
    `;
    expect(classifyField(document.getElementById("e")!).category).toBe(FieldCategory.EMAIL);
    expect(classifyField(document.getElementById("p")!).category).toBe(FieldCategory.PHONE);
  });

  it("autocomplete overrides a misleading label", () => {
    document.body.innerHTML = `
      <label for="x">Company</label>
      <input id="x" autocomplete="email" />
    `;
    expect(classifyField(document.getElementById("x")!).category).toBe(FieldCategory.EMAIL);
  });

  it("ignores autocomplete=off / on", () => {
    document.body.innerHTML = `<input id="f" name="email" autocomplete="off" />`;
    // Falls back to name heuristic → still EMAIL, not broken by off.
    expect(classifyField(document.getElementById("f")!).category).toBe(FieldCategory.EMAIL);
  });
});
