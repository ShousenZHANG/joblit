import { describe, expect, it } from "vitest";
import en from "../messages/en.json";
import zh from "../messages/zh.json";

// en/zh key-structure parity is asserted for every namespace in
// test/messagesContract.test.ts. This file pins landing COPY: the claims a
// visitor reads must stay true to the shipped product.

describe("landing message contract", () => {
  it.each([
    ["en", en.landing],
    ["zh", zh.landing],
  ] as const)(
    "never credits retired engines in %s — generation is local-first (ADR-0015)",
    (_locale, landing) => {
      const flattened = JSON.stringify(landing);
      expect(flattened).not.toMatch(/gemini/i);
      expect(flattened).not.toMatch(/extension/i);
      expect(flattened).not.toMatch(/seek/i);
    },
  );

  it.each([
    ["en", en.landing.logoBar],
    ["zh", zh.landing.logoBar],
  ] as const)("keeps every %s capability label non-empty", (_locale, logoBar) => {
    for (const value of Object.values(logoBar.items)) {
      expect(String(value).trim()).not.toBe("");
    }
  });

  it("uses the exact open-access English copy", () => {
    expect(en.landing.hero.metaFree).toBe(
      "Free for everyone · No credit card · Google or GitHub sign-in",
    );
    expect(en.landing.cta.lede).toBe(
      "Free for everyone, with no credit card. Sign in with Google or GitHub, add your profile once, and reuse it across discovery, tailoring, and applications.",
    );
  });

  it("keeps the local-first differentiator in the hero subtitle", () => {
    expect(en.landing.hero.subtitle).toMatch(/your own AI/i);
    expect(en.landing.hero.subtitle).toMatch(/your machine/i);
    expect(zh.landing.hero.subtitle).toContain("你自己的 AI");
  });
});
