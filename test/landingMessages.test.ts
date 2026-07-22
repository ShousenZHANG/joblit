import { describe, expect, it } from "vitest";
import en from "../messages/en.json";
import zh from "../messages/zh.json";

// en/zh key-structure parity is asserted for every namespace in
// test/messagesContract.test.ts. This file covers landing copy only.

describe("landing message contract", () => {
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

  it("uses the exact open-access English copy", () => {
    expect(en.landing.hero.metaFree).toBe(
      "Free for everyone · No credit card · Google or GitHub sign-in",
    );
    expect(en.landing.faq.items[2]?.a).toBe(
      "Yes — every Joblit feature is free for every signed-in user. No invitation, approval, subscription, or credit card is required.",
    );
    expect(en.landing.cta.lede).toBe(
      "Free for everyone, with no credit card. Sign in with Google or GitHub, add your profile once, and reuse it across discovery, tailoring, and applications.",
    );
  });

  it("uses the exact open-access Chinese copy", () => {
    expect(zh.landing.hero.metaFree).toBe(
      "所有人免费开放 · 无需信用卡 · Google 或 GitHub 登录",
    );
    expect(zh.landing.faq.items[2]?.a).toBe(
      "是的，Joblit 所有功能均向每位登录用户免费开放，无需邀请、审批、订阅或信用卡。",
    );
    expect(zh.landing.cta.lede).toBe(
      "面向所有人免费开放，无需信用卡。使用 Google 或 GitHub 登录，一次维护档案，即可贯穿岗位发现、材料定制与申请流程。",
    );
  });

  it.each([
    ["en", en.landing],
    ["zh", zh.landing],
  ] as const)("contains no retired invitation language in %s", (_locale, landing) => {
    const copy = JSON.stringify(landing).toLowerCase();
    for (const phrase of [
      "invite-only",
      "request access",
      "manual approval",
      "邀请制",
      "申请使用",
      "人工审批",
    ]) expect(copy).not.toContain(phrase);
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
