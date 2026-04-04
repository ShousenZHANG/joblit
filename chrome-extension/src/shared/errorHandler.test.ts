import { describe, it, expect } from "vitest";
import { classifyError, getErrorMessage } from "./errorHandler";

describe("classifyError", () => {
  it("classifies network errors as recoverable", () => {
    const err = new TypeError("Failed to fetch");
    const result = classifyError(err);
    expect(result.code).toBe("NETWORK");
    expect(result.recoverable).toBe(true);
  });

  it("classifies auth errors as non-recoverable", () => {
    const err = new Error("Not authenticated. Please connect your Jobflow account.");
    const result = classifyError(err);
    expect(result.code).toBe("AUTH");
    expect(result.recoverable).toBe(false);
  });

  it("classifies profile errors as recoverable", () => {
    const err = new Error("Flat profile fetch failed: 500");
    const result = classifyError(err);
    expect(result.code).toBe("PROFILE");
    expect(result.recoverable).toBe(true);
  });

  it("classifies unknown errors", () => {
    const result = classifyError("something");
    expect(result.code).toBe("UNKNOWN");
  });

  it("classifies unknown Error objects", () => {
    const err = new Error("Something weird happened");
    const result = classifyError(err);
    expect(result.code).toBe("UNKNOWN");
    expect(result.message).toBe("Something weird happened");
  });
});

describe("getErrorMessage", () => {
  it("extracts message from Error", () => {
    expect(getErrorMessage(new Error("test"))).toBe("test");
  });

  it("returns string directly", () => {
    expect(getErrorMessage("a string")).toBe("a string");
  });

  it("returns fallback for non-Error/string", () => {
    expect(getErrorMessage(42)).toBe("An unexpected error occurred.");
  });
});
