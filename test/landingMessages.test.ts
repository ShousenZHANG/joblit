import { describe, expect, it } from "vitest";
import en from "../messages/en.json";
import zh from "../messages/zh.json";

// Locale shape and key usage are covered by messagesContract.test.ts.
// These claims distinguish the current local-generation product from the
// retired paste loop and a hosted, automatic application service.
describe("landing product claims", () => {
  it.each([
    ["en", en.landingExperience],
    ["zh", zh.landingExperience],
  ] as const)("does not advertise retired workflows in %s", (_locale, landing) => {
    expect(JSON.stringify(landing)).not.toMatch(
      /\brunner\b|browser extension|paste.{0,30}(prompt|json)|copy.{0,30}prompt|浏览器扩展|粘贴.{0,15}(提示词|JSON)/i,
    );
  });

  it("states the Australian LinkedIn scope in both languages", () => {
    const english = en.landingExperience.faq.items[0].answer;
    const chinese = zh.landingExperience.faq.items[0].answer;
    expect(english).toMatch(/Australian LinkedIn/);
    expect(chinese).toMatch(/澳大利亚.{0,5}LinkedIn/);
  });

  it("discloses local Hermes and the visitor's own model account before generation", () => {
    const english = en.landingExperience.gettingStarted.step3Description;
    const chinese = zh.landingExperience.gettingStarted.step3Description;
    expect(english).toMatch(/Hermes/);
    expect(english).toMatch(/your own computer/);
    expect(english).toMatch(/your own model account/);
    expect(chinese).toContain("Hermes");
    expect(chinese).toContain("你自己的电脑");
    expect(chinese).toContain("你自己的模型账号");
  });

  it("keeps tailoring grounded in existing skills and preserves career experience", () => {
    const english = en.landingExperience.faq.items[2].answer;
    const chinese = zh.landingExperience.faq.items[2].answer;
    expect(english).toMatch(/skills already in your profile/);
    expect(english).toMatch(/does not rewrite your career experience/);
    expect(chinese).toContain("已有档案");
    expect(chinese).toContain("不会重写你的职业经历");
  });

  it("distinguishes example data from live generation and user-submitted applications", () => {
    expect(en.landingExperience.faq.items[1].answer).toMatch(/example roles/);
    expect(zh.landingExperience.faq.items[1].answer).toContain("示例职位");
    expect(en.landingExperience.faq.items[3].answer).toMatch(/submit the application yourself/);
    expect(zh.landingExperience.faq.items[3].answer).toContain("自行");
  });
});
