import { afterEach, describe, expect, it, vi } from "vitest";
import { digest, issueTaskCapability, validTaskCapability } from "./capability";

afterEach(() => vi.unstubAllEnvs());
describe("local task capability", () => {
  const scope = { id: "task", userId: "owner", jobId: "job", target: "resume", expiresAt: new Date("2026-09-07T00:00:00Z") };
  it("reissues the same scoped capability without storing it and rejects every changed scope", () => {
    vi.stubEnv("AUTH_SECRET", "test-only-signing-secret");
    const token = issueTaskCapability(scope);
    expect(issueTaskCapability(scope)).toBe(token);
    expect(validTaskCapability(token, digest(token))).toBe(true);
    for (const changed of [{ id: "other" }, { userId: "other" }, { jobId: "other" }, { target: "cover" }, { expiresAt: new Date("2026-09-08") }]) {
      expect(validTaskCapability(issueTaskCapability({ ...scope, ...changed }), digest(token))).toBe(false);
    }
    expect(validTaskCapability(`${token.slice(0, -1)}!`, digest(token))).toBe(false);
    expect(validTaskCapability(token, "malformed")).toBe(false);
  });
  it("fails closed without a signing secret", () => {
    vi.stubEnv("AUTH_SECRET", "");
    expect(() => issueTaskCapability(scope)).toThrow("Local generation is not configured");
  });
});
