import { describe, expect, it } from "vitest";

import { createMemoryAbuseBudgetPort } from "./abuseBudgetMemory";

describe("createMemoryAbuseBudgetPort", () => {
  it("allows exactly N of N+1 concurrent consumers", async () => {
    const port = createMemoryAbuseBudgetPort({ now: () => 1_000 });

    const decisions = await Promise.all(
      Array.from({ length: 6 }, () =>
        port.consume([
          {
            key: "user:fingerprint",
            limit: 5,
            windowMs: 60_000,
          },
        ]),
      ),
    );

    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(5);
    expect(decisions.filter((decision) => !decision.allowed)).toHaveLength(1);
    expect(decisions.at(-1)).toEqual({
      allowed: false,
      remaining: 0,
      resetAt: 61_000,
      retryAfter: 60,
    });
  });

  it("rejects the whole operation when any debit would exceed its budget", async () => {
    const port = createMemoryAbuseBudgetPort({ now: () => 5_000 });

    await expect(
      port.consume([
        { key: "ip:fingerprint", limit: 2, windowMs: 10_000 },
        { key: "user:id", limit: 1, windowMs: 10_000 },
      ]),
    ).resolves.toMatchObject({ allowed: true });

    await expect(
      port.consume([
        { key: "ip:fingerprint", limit: 2, windowMs: 10_000 },
        { key: "user:id", limit: 1, windowMs: 10_000 },
      ]),
    ).resolves.toEqual({
      allowed: false,
      remaining: 0,
      resetAt: 15_000,
      retryAfter: 10,
    });

    // The rejected operation must not consume the still-available IP budget.
    await expect(
      port.consume([
        { key: "ip:fingerprint", limit: 2, windowMs: 10_000 },
      ]),
    ).resolves.toEqual({
      allowed: true,
      remaining: 0,
      resetAt: 15_000,
      retryAfter: 0,
    });
  });

  it("starts a fresh fixed window after the previous one expires", async () => {
    let now = 10_000;
    const port = createMemoryAbuseBudgetPort({ now: () => now });
    const debit = { key: "token:id", limit: 1, windowMs: 2_000 };

    await expect(port.consume([debit])).resolves.toMatchObject({
      allowed: true,
      resetAt: 12_000,
    });
    await expect(port.consume([debit])).resolves.toMatchObject({
      allowed: false,
      retryAfter: 2,
    });

    now = 12_001;

    await expect(port.consume([debit])).resolves.toEqual({
      allowed: true,
      remaining: 0,
      resetAt: 14_001,
      retryAfter: 0,
    });
  });

  it("rejects ambiguous duplicate keys before mutating any budget", async () => {
    const port = createMemoryAbuseBudgetPort({ now: () => 1_000 });

    await expect(
      port.consume([
        { key: "same:key", limit: 5, windowMs: 1_000 },
        { key: "same:key", limit: 5, windowMs: 1_000 },
      ]),
    ).rejects.toThrow(/duplicate/i);

    await expect(
      port.consume([
        { key: "same:key", limit: 1, windowMs: 1_000 },
      ]),
    ).resolves.toMatchObject({ allowed: true });
  });
});
