import { describe, expect, it } from "vitest";
import { findDirectServerFetchCalls } from "./server-fetch-policy.mjs";

describe("server outbound fetch policy", () => {
  it("detects unqualified and explicit global fetch calls", () => {
    const calls = findDirectServerFetchCalls(
      [
        "await fetch('https://example.com');",
        "await globalThis.fetch('https://example.com');",
        "await global.fetch('https://example.com');",
      ].join("\n"),
    );

    expect(calls).toEqual([
      { line: 1, column: 7 },
      { line: 2, column: 7 },
      { line: 3, column: 7 },
    ]);
  });

  it("ignores adapter methods, comments, and string literals", () => {
    const calls = findDirectServerFetchCalls(
      [
        "await adapter.fetch(context);",
        "// fetch('https://example.com')",
        "const example = \"fetch('https://example.com')\";",
      ].join("\n"),
    );

    expect(calls).toEqual([]);
  });
});
