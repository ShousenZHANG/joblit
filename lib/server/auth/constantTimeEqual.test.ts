import { describe, it, expect } from "vitest";
import { constantTimeEqual } from "./constantTimeEqual";

describe("constantTimeEqual", () => {
  it("returns true for identical strings", () => {
    expect(constantTimeEqual("s3cret-token", "s3cret-token")).toBe(true);
  });

  it("returns false for different strings of equal length", () => {
    expect(constantTimeEqual("aaaaaa", "aaaaab")).toBe(false);
  });

  it("returns false for different lengths", () => {
    expect(constantTimeEqual("short", "longer-secret")).toBe(false);
  });

  it("returns false for nullish/empty inputs", () => {
    expect(constantTimeEqual(null, "x")).toBe(false);
    expect(constantTimeEqual("x", null)).toBe(false);
    expect(constantTimeEqual(undefined, undefined)).toBe(false);
    expect(constantTimeEqual("", "")).toBe(false);
    expect(constantTimeEqual("", "x")).toBe(false);
  });
});
