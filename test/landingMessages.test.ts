import { describe, expect, it } from "vitest";
import en from "../messages/en.json";
import zh from "../messages/zh.json";

function shape(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(shape);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, shape(child)]),
    );
  }
  return typeof value;
}

describe("landing message contract", () => {
  it("keeps English and Chinese key structures aligned", () => {
    expect(shape(zh.landing)).toEqual(shape(en.landing));
  });

  it.each([
    ["en", en.landing.faq.items],
    ["zh", zh.landing.faq.items],
  ] as const)("keeps six non-empty %s FAQ entries", (_locale, items) => {
    expect(items).toHaveLength(6);
    for (const item of items) {
      expect(item.q.trim()).not.toBe("");
      expect(item.a.trim()).not.toBe("");
    }
  });

  it.each([
    ["en", en.landing],
    ["zh", zh.landing],
  ] as const)("describes the shipped Gemini and external Skill Pack paths in %s", (_locale, landing) => {
    expect(landing.features.tailor.blurb).toContain("Gemini");
    expect(landing.features.output.blurb).toContain("Skill Pack");
    expect(landing.features.output.blurb).toContain("Claude");
    expect(landing.features.output.blurb).toContain("ChatGPT");
    expect(landing.features.output.blurb).toContain("Gemini");
    expect(landing.faq.items[4]?.a).toContain("Skill Pack");
  });

  it.each([
    ["en", { landing: en.landing, marketing: en.marketing }],
    ["zh", { landing: zh.landing, marketing: zh.marketing }],
  ] as const)("rejects unsupported marketing claims in %s", (_locale, messages) => {
    const copy = JSON.stringify(messages).toLowerCase();
    for (const phrase of [
      "streamed generation",
      "under five seconds",
      "no loading spinner",
      "bring your own llm key",
      "bring-your-own-llm",
      "we never see it",
      "zero copy-paste",
      "free forever",
      "two minutes",
      "takes two minutes",
      "不超过 5 秒",
      "无需等待加载",
      "自带 llm key",
      "我们完全看不到",
      "两分钟即可",
      "零复制粘贴",
      "永久免费",
    ]) {
      expect(copy).not.toContain(phrase);
    }
  });
});
