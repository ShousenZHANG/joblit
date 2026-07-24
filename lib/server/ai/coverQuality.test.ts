import { describe, expect, it } from "vitest";

import { evaluateCoverQuality } from "./coverQuality";

function padChinese(prefix: string, targetLength: number) {
  return (
    prefix +
    "持续推动平台可靠交付并通过清晰协作改善工程质量".repeat(40)
  ).slice(0, targetLength);
}

describe("evaluateCoverQuality locale semantics", () => {
  it("counts zh-CN characters and preserves Chinese evidence tokens", () => {
    const report = evaluateCoverQuality({
      draft: {
        paragraphOne: padChinese(
          "我具备**云平台**架构设计与自动化交付经验，",
          140,
        ),
        paragraphTwo: padChinese(
          "我曾负责云平台架构设计并推动自动化交付，通过**可靠性**治理和**工程效率**改进支持业务，",
          200,
        ),
        paragraphThree: padChinese(
          "示例科技的云平台方向与我的经验一致，期待进一步讨论如何贡献，",
          140,
        ),
      },
      context: {
        topResponsibilities: [
          "负责云平台架构设计",
          "推动自动化交付",
        ],
        matchedEvidence: [
          "负责云平台架构设计并推动自动化交付",
          "通过可靠性治理改善工程效率",
        ],
        resumeHighlights: [],
      },
      company: "示例科技",
      targetWordRange: { min: 400, max: 600 },
      localeProfile: "zh-CN",
    });

    expect(report.wordCount).toBeGreaterThanOrEqual(400);
    expect(report.wordCount).toBeLessThanOrEqual(600);
    expect(report).toMatchObject({ passed: true, issues: [] });
  });
});
