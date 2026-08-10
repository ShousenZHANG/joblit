import { describe, it, expect } from "vitest";
import {
  replaceTokens,
  sanitizeRendered,
  renderBullets,
  renderLinks,
  replaceLiteral,
} from "./templateUtils";

describe("replaceTokens", () => {
  it("replaces {{KEY}} tokens with values", () => {
    const template = "Hello {{NAME}}, welcome to {{PLACE}}.";
    const result = replaceTokens(template, {
      NAME: "Alice",
      PLACE: "Wonderland",
    });
    expect(result).toBe("Hello Alice, welcome to Wonderland.");
  });

  it("replaces multiple occurrences of same token", () => {
    const template = "{{X}} and {{X}}";
    expect(replaceTokens(template, { X: "yes" })).toBe("yes and yes");
  });

  it("leaves unmatched tokens untouched", () => {
    const template = "{{A}} and {{B}}";
    expect(replaceTokens(template, { A: "1" })).toBe("1 and {{B}}");
  });

  it("handles empty map", () => {
    const template = "{{A}}";
    expect(replaceTokens(template, {})).toBe("{{A}}");
  });
});

describe("sanitizeRendered", () => {
  it("removes surrogate pairs", () => {
    expect(sanitizeRendered("abc\uD800\uDFFFdef")).toBe("abcdef");
  });

  it("removes replacement character", () => {
    expect(sanitizeRendered("abc\uFFFDdef")).toBe("abcdef");
  });

  it("removes emoji from supplementary planes", () => {
    // U+1F600 is a grinning face emoji
    expect(sanitizeRendered("hello \u{1F600} world")).toBe("hello  world");
  });

  it("passes through normal text unchanged", () => {
    const text = "Hello, World! This is normal text.";
    expect(sanitizeRendered(text)).toBe(text);
  });
});

describe("renderBullets", () => {
  it("renders array of items as LaTeX \\item entries", () => {
    const result = renderBullets(["First point", "Second point"]);
    expect(result).toBe("\\item First point\n\\item Second point");
  });

  it("returns empty string for empty array", () => {
    expect(renderBullets([])).toBe("");
  });

  it("handles single item", () => {
    expect(renderBullets(["Only one"])).toBe("\\item Only one");
  });
});

describe("renderLinks", () => {
  it("renders links as LaTeX \\href entries", () => {
    const links = [
      { label: "GitHub", url: "https://github.com" },
      { label: "Site", url: "https://example.com" },
    ];
    const result = renderLinks(links);
    expect(result).toBe(
      "\\href{https://github.com}{GitHub} \\;|\\; \\href{https://example.com}{Site}",
    );
  });

  it("returns empty string for empty array", () => {
    expect(renderLinks([])).toBe("");
  });

  it("renders single link without separator", () => {
    const result = renderLinks([{ label: "Link", url: "https://a.com" }]);
    expect(result).toBe("\\href{https://a.com}{Link}");
  });

  it("supports custom separator", () => {
    const links = [
      { label: "A", url: "https://a.com" },
      { label: "B", url: "https://b.com" },
    ];
    const result = renderLinks(links, " | ");
    expect(result).toBe("\\href{https://a.com}{A} | \\href{https://b.com}{B}");
  });
});

/**
 * `String.prototype.replace` reads `$&`, `` $` ``, `$'` and `$1` out of its
 * REPLACEMENT argument. Rendered LaTeX is full of `\$` from escapeLatex, so a
 * resume bullet or cover paragraph containing the wrong two characters could
 * splice the template's own preamble into the document body — silently, in a
 * PDF the user then sends to an employer.
 */
describe("replaceLiteral", () => {
  it("treats $-patterns in the replacement as literal text", () => {
    const template = "PREAMBLE\n\input{content}\nTAIL";

    // Each of these is a real special pattern for String.replace.
    for (const payload of ["$&", "$`", "$'", "$1", "cost: $&100"]) {
      expect(replaceLiteral(template, "\input{content}", payload)).toBe(
        `PREAMBLE\n${payload}\nTAIL`,
      );
    }
  });

  it("differs from String.replace on exactly the case that corrupts a document", () => {
    // Pin the reason this helper exists. `$\`` re-inserts everything before the
    // match — the entire preamble — into the middle of the rendered document.
    const template = "PREAMBLE\n\input{content}\nTAIL";
    const naive = template.replace("\input{content}", "$`");
    expect(naive).toContain("PREAMBLE\nPREAMBLE");
    expect(replaceLiteral(template, "\input{content}", "$`")).toBe(
      "PREAMBLE\n$`\nTAIL",
    );
  });

  it("replaces only the first occurrence, like the call sites expect", () => {
    expect(replaceLiteral("a X b X c", "X", "1")).toBe("a 1 b X c");
  });

  it("returns the text unchanged when the placeholder is absent", () => {
    expect(replaceLiteral("no marker here", "\input{content}", "x")).toBe(
      "no marker here",
    );
  });
});
