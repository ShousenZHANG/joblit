import { afterEach, describe, expect, it, vi } from "vitest";
import { enforceAiRateLimit } from "./aiRateLimit";

describe("enforceAiRateLimit", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests under the per-user limit", () => {
    const userId = `user-allow-${Math.random()}`;
    for (let i = 0; i < 20; i += 1) {
      expect(enforceAiRateLimit(userId, "req")).toBeNull();
    }
  });

  it("returns 429 once the limit is exceeded", async () => {
    const userId = `user-block-${Math.random()}`;
    for (let i = 0; i < 20; i += 1) enforceAiRateLimit(userId, "req");

    const blocked = enforceAiRateLimit(userId, "req-21");
    expect(blocked).not.toBeNull();
    expect(blocked!.status).toBe(429);
    const json = await blocked!.json();
    expect(json.error.code).toBe("RATE_LIMITED");
    expect(blocked!.headers.get("Retry-After")).toBeTruthy();
  });

  it("isolates limits per user", () => {
    const a = `user-a-${Math.random()}`;
    const b = `user-b-${Math.random()}`;
    for (let i = 0; i < 20; i += 1) enforceAiRateLimit(a, "req");
    // a is now exhausted; b should still be allowed
    expect(enforceAiRateLimit(a, "req")).not.toBeNull();
    expect(enforceAiRateLimit(b, "req")).toBeNull();
  });
});
