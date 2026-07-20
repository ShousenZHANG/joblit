import { afterEach, describe, expect, it, vi } from "vitest";

const buildTailorPrompts = vi.hoisted(() =>
  vi.fn((rules: unknown, input: unknown) => {
    void rules;
    void input;
    return {
      systemPrompt: "system",
      userPrompt: "user",
    };
  }),
);

vi.mock("@/lib/server/ai/buildPrompt", () => ({
  buildTailorPrompts,
}));

vi.mock("@/lib/server/promptRuleTemplates", () => ({
  getActivePromptSkillRulesForUser: vi.fn(() => ({
    id: "rules-active-1",
    locale: "en-AU",
    cvRules: ["cv-rule"],
    coverRules: ["cover-rule"],
    hardConstraints: ["json-only"],
  })),
}));

import { tailorApplicationContent } from "@/lib/server/ai/tailorApplication";
import * as providers from "@/lib/server/ai/providers";

const INPUT = {
  baseSummary: "Experienced full-stack engineer focused on product delivery.",
  jobTitle: "Software Engineer",
  company: "Example Co",
  description: "Build customer-facing features with TypeScript and React.",
};

describe("tailorApplicationContent", () => {
  const originalKey = process.env.GEMINI_API_KEY;
  const originalModel = process.env.GEMINI_MODEL;

  afterEach(() => {
    process.env.GEMINI_API_KEY = originalKey;
    process.env.GEMINI_MODEL = originalModel;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("keeps base summary when API key is missing", async () => {
    delete process.env.GEMINI_API_KEY;

    const result = await tailorApplicationContent(INPUT);
    expect(result.cvSummary).toBe(INPUT.baseSummary);
    expect(result.source.cv).toBe("base");
  });

  it("keeps base summary when AI response is invalid", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.spyOn(providers, "callProvider").mockResolvedValueOnce("not-json");

    const result = await tailorApplicationContent(INPUT);
    expect(result.cvSummary).toBe(INPUT.baseSummary);
    expect(result.source.cv).toBe("base");
  });

  it("uses default skill rules when prompting the model", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.spyOn(providers, "callProvider").mockResolvedValueOnce(
      JSON.stringify({
        cvSummary: "AI Summary",
        cover: {
          paragraphOne: "One",
          paragraphTwo: "Two",
          paragraphThree: "Three",
        },
      }),
    );

    await tailorApplicationContent({ ...INPUT, userId: "user-1" });

    expect(buildTailorPrompts).toHaveBeenCalled();
    const passedRules = buildTailorPrompts.mock.calls[0][0] as {
      cvRules: string[];
      coverRules: string[];
    };
    expect(passedRules.cvRules.length).toBeGreaterThan(0);
    expect(passedRules.coverRules.length).toBeGreaterThan(0);
  });

  it("builds cover evidence from resume snapshot and passes it to prompt builder", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.spyOn(providers, "callProvider").mockResolvedValueOnce(
      JSON.stringify({
        cvSummary: "AI Summary",
        cover: {
          paragraphOne: "One",
          paragraphTwo: "Two",
          paragraphThree: "Three",
        },
      }),
    );

    await tailorApplicationContent({
      ...INPUT,
      userId: "user-1",
      description:
        "Design backend APIs and improve CI/CD deployment reliability on AWS cloud platforms.",
      resumeSnapshot: {
        summary: "Backend engineer focused on API delivery and platform reliability.",
        experiences: [
          {
            title: "Software Engineer",
            company: "Acme",
            bullets: ["Built Java APIs and automated CI/CD deployment pipelines on AWS."],
          },
        ],
        projects: [
          {
            name: "Payments Platform",
            stack: "Java, AWS",
            bullets: ["Improved deployment reliability and API response consistency."],
          },
        ],
        skills: [{ category: "Cloud", items: ["AWS", "Docker"] }],
      },
    });

    const passedInput = buildTailorPrompts.mock.calls[0][1] as {
      coverContext?: {
        topResponsibilities: string[];
        matchedEvidence: string[];
      };
    };
    expect(passedInput.coverContext?.topResponsibilities.length).toBeGreaterThan(0);
    expect(passedInput.coverContext?.matchedEvidence.join(" ")).toContain("AWS");
    expect(passedInput.coverContext?.matchedEvidence.join(" ")).toContain("API");
  });

  it("retries with provider default model when custom model fails", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    process.env.GEMINI_MODEL = "gemini-2.5-pro";

    const callProviderSpy = vi
      .spyOn(providers, "callProvider")
      .mockRejectedValueOnce(new Error("OPENAI_400"))
      .mockResolvedValueOnce(
        JSON.stringify({
          cvSummary: "AI Summary",
          cover: {
            paragraphOne: "One",
            paragraphTwo: "Two",
            paragraphThree: "Three",
          },
        }),
      );

    const result = await tailorApplicationContent({ ...INPUT, userId: "user-1" });

    expect(result.reason).toBe("ai_ok");
    expect(callProviderSpy).toHaveBeenNthCalledWith(
      1,
      "gemini",
      expect.objectContaining({ model: "gemini-2.5-pro" }),
    );
    expect(callProviderSpy).toHaveBeenNthCalledWith(
      2,
      "gemini",
      expect.objectContaining({ model: "gemini-2.5-flash-lite" }),
    );
  });

  it("runs one rewrite pass when strict cover quality is enabled", async () => {
    process.env.GEMINI_API_KEY = "test-key";

    const callProviderSpy = vi
      .spyOn(providers, "callProvider")
      .mockResolvedValueOnce(
        JSON.stringify({
          cvSummary: "AI Summary",
          cover: {
            paragraphOne:
              "I am writing to express interest in this role and believe my background is a strong fit.",
            paragraphTwo:
              "I have worked on various projects and can contribute quickly across different areas.",
            paragraphThree:
              "I am excited by this opportunity and would value a chance to discuss further.",
          },
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          cvSummary: "AI Summary",
          cover: {
            paragraphOne:
              "I am applying for the **Software Engineer** role at Example Co and bring delivery-focused experience in **TypeScript** and **React** for customer-facing products.",
            paragraphTwo:
              "Against your top responsibilities, I have shipped **TypeScript** features end-to-end, improved frontend performance in **React**, and coordinated reliable production releases with measurable quality improvements.",
            paragraphThree:
              "This role appeals to me because **Example Co** is building customer-facing products where my strengths in product engineering, cross-functional execution, and sustainable delivery quality can add immediate value.",
          },
        }),
      );

    const result = await tailorApplicationContent(INPUT, {
      strictCoverQuality: true,
      maxCoverRewritePasses: 1,
      localeProfile: "en-AU",
      targetWordRange: { min: 60, max: 360 },
    });

    expect(callProviderSpy).toHaveBeenCalledTimes(2);
    expect(result.cover.paragraphTwo).toContain("TypeScript");
    expect(["ai_ok", "quality_gate_failed"]).toContain(result.reason);
  });

  it("uses fallback cover text when strict cover quality still fails", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.spyOn(providers, "callProvider").mockResolvedValueOnce(
      JSON.stringify({
        cvSummary: "AI Summary",
        cover: {
          paragraphOne: "Generic opening.",
          paragraphTwo: "Generic body.",
          paragraphThree: "Generic closing.",
        },
      }),
    );

    const result = await tailorApplicationContent(INPUT, {
      strictCoverQuality: true,
      maxCoverRewritePasses: 0,
      localeProfile: "en-AU",
      targetWordRange: { min: 280, max: 360 },
    });

    expect(result.reason).toBe("quality_gate_failed");
    expect(result.source.cover).toBe("fallback");
    expect(result.cover.paragraphOne).toContain("I am applying for the Software Engineer position at Example Co");
    expect(result.cover.paragraphOne).not.toBe("Generic opening.");
  });

  it("runs an independent second pass and returns its grounded revision", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const callProviderSpy = vi
      .spyOn(providers, "callProvider")
      .mockResolvedValueOnce(
        JSON.stringify({
          cvSummary: "Initial summary",
          cover: {
            paragraphOne: "Initial one",
            paragraphTwo: "Initial two",
            paragraphThree: "Initial three",
          },
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          cvSummary: "Reviewed TypeScript summary",
          cover: {
            paragraphOne: "Reviewed one",
            paragraphTwo: "Reviewed TypeScript evidence",
            paragraphThree: "Reviewed three",
          },
        }),
      );

    const result = await tailorApplicationContent(INPUT, {
      maxReviewerPasses: 1,
      requireIndependentReview: true,
    });

    expect(callProviderSpy).toHaveBeenCalledTimes(2);
    expect(result.cvSummary).toBe("Reviewed TypeScript summary");
    expect(result.reviewer).toMatchObject({ ran: true, revised: true });
  });

  it("fails closed when a required independent review is invalid", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.spyOn(providers, "callProvider")
      .mockResolvedValueOnce(
        JSON.stringify({
          cvSummary: "Initial summary",
          cover: {
            paragraphOne: "Initial one",
            paragraphTwo: "Initial two",
            paragraphThree: "Initial three",
          },
        }),
      )
      .mockResolvedValueOnce("not-json");

    await expect(
      tailorApplicationContent(INPUT, {
        maxReviewerPasses: 1,
        requireIndependentReview: true,
      }),
    ).rejects.toThrow("INDEPENDENT_REVIEW_INVALID");
  });
});
