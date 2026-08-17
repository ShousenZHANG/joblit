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
    "never credits retired pipelines in %s — generation is the paste loop (ADR-0022)",
    (_locale, landing) => {
      const flattened = JSON.stringify(landing);
      // The Runner → Codex pipeline, the browser extension, and the retired
      // feed adapters must never resurface in marketing copy. Named paste
      // targets (Claude, ChatGPT, Gemini) are allowed: the user's own
      // chatbot is the engine now, and naming examples is honest.
      expect(flattened).not.toMatch(/runner/i);
      expect(flattened).not.toMatch(/codex/i);
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
  });

  it.each([
    ["en", en.landing.bento],
    ["zh", zh.landing.bento],
  ] as const)(
    "keeps the %s AI section readable by a non-technical visitor",
    (_locale, bento) => {
      // Engineering jargon is banned from the bento: the section exists to
      // make the AI legible to someone who has never opened a terminal.
      const flattened = JSON.stringify(bento);
      expect(flattened).not.toMatch(/content-addressed/i);
      expect(flattened).not.toMatch(/deterministic/i);
      expect(flattened).not.toMatch(/issue-?key/i);
      expect(flattened).not.toMatch(/loopback/i);
    },
  );

  it("keeps the paste-loop differentiator in the hero subtitle", () => {
    // The hero must tell the true generation story: the visitor's own
    // chatbot writes, and Joblit's servers hold no model keys (ADR-0015).
    expect(en.landing.hero.subtitle).toMatch(/chatbot you already use/i);
    expect(en.landing.hero.subtitle).toMatch(/no model keys/i);
    expect(zh.landing.hero.subtitle).toContain("聊天助手");
    expect(zh.landing.hero.subtitle).toContain("模型密钥");
  });

  it("pins the architecture boundary claim word for word", () => {
    // The dashed boundary encloses only the chatbot node; this caption is
    // the page's strongest claim and must not be watered down in a rewrite.
    expect(en.landing.architecture.boundaryCaption).toBe(
      "Joblit never sees your model account.",
    );
  });
});
