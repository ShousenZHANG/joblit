import { describe, expect, it } from "vitest";

import {
  escapeTsvCell,
  sanitizeMarkdown,
  sanitizePipelineUrl,
} from "./untrustedOutput";

describe("sanitizeMarkdown", () => {
  it("preserves normal markdown and neutralises active content", () => {
    const input =
      "**Backend** [portfolio](https://example.com/me) " +
      "[attack](javascript:alert(1)) ![tracker](https://evil.example/pixel) " +
      "<script>alert(1)</script>\u202E";
    const output = sanitizeMarkdown(input);
    expect(output).toContain("**Backend**");
    expect(output).toContain("[portfolio](https://example.com/me)");
    expect(output).not.toContain("javascript:");
    expect(output).not.toContain("![tracker]");
    expect(output).toContain("&lt;script&gt;");
    expect(output).not.toContain("\u202E");
  });
});

describe("escapeTsvCell", () => {
  it.each(["=cmd()", "+SUM(A1:A2)", "-1+2", "@IMPORTXML(A1)"])(
    "neutralises spreadsheet formula %s",
    (value) => {
      expect(escapeTsvCell(value)).toBe(`'${value}`);
    },
  );

  it("removes TSV structure and control characters", () => {
    expect(escapeTsvCell("hello\tworld\nnext\u0000")).toBe(
      "hello world next",
    );
  });
});

describe("sanitizePipelineUrl", () => {
  it("requires HTTPS, strips fragments and secret query values", () => {
    expect(
      sanitizePipelineUrl(
        "https://jobs.example.com/role?id=1&api_key=secret#section",
        { allowedHosts: ["example.com"], allowSubdomains: true },
      ),
    ).toBe("https://jobs.example.com/role?id=1");
    expect(sanitizePipelineUrl("javascript:alert(1)")).toBeNull();
    expect(sanitizePipelineUrl("https://127.0.0.1/admin")).toBeNull();
  });

  it("uses dot-anchored host allowlisting", () => {
    expect(
      sanitizePipelineUrl("https://evil-example.com", {
        allowedHosts: ["example.com"],
        allowSubdomains: true,
      }),
    ).toBeNull();
  });
});
