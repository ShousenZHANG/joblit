import { afterEach, describe, expect, it, vi } from "vitest";

// Records the arguments while the real builder still runs, so the assertions
// below keep working and the orchestrator exercises the prompt it actually
// sends. Replacing the builder outright left buildPrompt.ts covered by nothing.
const buildTailorPrompts = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/ai/buildPrompt", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/server/ai/buildPrompt")>();
  return {
    buildTailorPrompts: (
      ...args: Parameters<typeof actual.buildTailorPrompts>
    ) => {
      buildTailorPrompts(...args);
      return actual.buildTailorPrompts(...args);
    },
  };
});

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

// The resume prompt is told apart by its own instruction rather than by a
// stub's placeholder string, so the orchestrator can run the real builder.
const isResumePrompt = (prompt: string) =>
  prompt.includes("produce cvSummary and latestExperience.addedBullets");

import { buildPromptContentHash } from "@/lib/server/ai/promptContract";
import * as providers from "@/lib/server/ai/providers";

const INPUT = {
  baseSummary: "Experienced full-stack engineer focused on product delivery.",
  jobTitle: "Software Engineer",
  company: "Example Co",
  description: "Build customer-facing features with TypeScript and React.",
};

const RESUME_OUTPUT = JSON.stringify({
  cvSummary: "AI Summary",
  latestExperience: { addedBullets: [] },
});
const COVER_OUTPUT = JSON.stringify({
  cover: {
    paragraphOne: "One",
    paragraphTwo: "Two",
    paragraphThree: "Three",
  },
});

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
    vi.spyOn(providers, "callProvider").mockResolvedValue("not-json");

    const result = await tailorApplicationContent(INPUT);
    expect(result.cvSummary).toBe(INPUT.baseSummary);
    expect(result.source.cv).toBe("base");
  });

  it("uses default skill rules when prompting the model", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.spyOn(providers, "callProvider")
      .mockResolvedValueOnce(RESUME_OUTPUT)
      .mockResolvedValueOnce(COVER_OUTPUT);

    await tailorApplicationContent({ ...INPUT, userId: "user-1" });

    expect(buildTailorPrompts).toHaveBeenCalled();
    const passedRules = buildTailorPrompts.mock.calls[0][0] as {
      cvRules: string[];
      coverRules: string[];
    };
    expect(passedRules.cvRules.length).toBeGreaterThan(0);
    expect(passedRules.coverRules.length).toBeGreaterThan(0);
  });

  it("calls only the missing cover target during partial recovery", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const callProviderSpy = vi
      .spyOn(providers, "callProvider")
      .mockResolvedValueOnce(COVER_OUTPUT);

    const result = await tailorApplicationContent(INPUT, {
      targets: ["cover"],
    });

    expect(callProviderSpy).toHaveBeenCalledOnce();
    expect(callProviderSpy).toHaveBeenCalledWith(
      "gemini",
      expect.objectContaining({
        userPrompt: expect.stringContaining(
          "Generate a cover letter for this role",
        ),
      }),
    );
    expect(result.source.cv).toBe("base");
    expect(result.source.cover).toBe("ai");
  });

  it("calls only the missing resume target during partial recovery", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const callProviderSpy = vi
      .spyOn(providers, "callProvider")
      .mockResolvedValueOnce(RESUME_OUTPUT);

    const result = await tailorApplicationContent(INPUT, {
      targets: ["resume"],
    });

    expect(callProviderSpy).toHaveBeenCalledOnce();
    expect(callProviderSpy).toHaveBeenCalledWith(
      "gemini",
      expect.objectContaining({
        userPrompt: expect.stringContaining(
          "produce cvSummary and latestExperience.addedBullets",
        ),
      }),
    );
    expect(result.source.cv).toBe("ai");
    expect(result.source.cover).toBe("fallback");
  });

  it("keeps an independent cover review target-scoped", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const callProviderSpy = vi
      .spyOn(providers, "callProvider")
      .mockResolvedValueOnce(COVER_OUTPUT)
      .mockResolvedValueOnce(
        JSON.stringify({
          cover: {
            paragraphOne: "Reviewed one",
            paragraphTwo: "Reviewed TypeScript evidence",
            paragraphThree: "Reviewed three",
          },
        }),
      );

    const result = await tailorApplicationContent(INPUT, {
      targets: ["cover"],
      maxReviewerPasses: 1,
      requireIndependentReview: true,
    });

    expect(callProviderSpy).toHaveBeenCalledTimes(2);
    expect(
      callProviderSpy.mock.calls.some(
        ([, request]) => isResumePrompt(request.userPrompt),
      ),
    ).toBe(false);
    expect(result.cover.paragraphTwo).toContain("TypeScript");
    expect(result.reviewer).toMatchObject({ ran: true, revised: true });
  });

  it("builds cover evidence from resume snapshot and passes it to prompt builder", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.spyOn(providers, "callProvider")
      .mockResolvedValueOnce(RESUME_OUTPUT)
      .mockResolvedValueOnce(COVER_OUTPUT);

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
      .mockImplementation(async (_provider, request) => {
        if (
          request.model === "gemini-2.5-pro" &&
          isResumePrompt(request.userPrompt)
        ) {
          throw new Error("OPENAI_400");
        }
        return isResumePrompt(request.userPrompt)
          ? RESUME_OUTPUT
          : COVER_OUTPUT;
      });

    const result = await tailorApplicationContent({ ...INPUT, userId: "user-1" });

    expect(result.reason).toBe("ai_ok");
    expect(callProviderSpy).toHaveBeenNthCalledWith(
      1,
      "gemini",
      expect.objectContaining({ model: "gemini-2.5-pro" }),
    );
    expect(callProviderSpy).toHaveBeenCalledWith(
      "gemini",
      expect.objectContaining({
        model: "gemini-2.5-flash-lite",
        userPrompt: expect.stringContaining(
          "produce cvSummary and latestExperience.addedBullets",
        ),
      }),
    );
  });

  it("runs one rewrite pass when strict cover quality is enabled", async () => {
    process.env.GEMINI_API_KEY = "test-key";

    const callProviderSpy = vi
      .spyOn(providers, "callProvider")
      .mockResolvedValueOnce(RESUME_OUTPUT)
      .mockResolvedValueOnce(
        JSON.stringify({
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
          cover: {
            paragraphOne:
              "I am applying for the **Software Engineer** role at Example Co as a full-stack engineer with grounded product delivery experience in **TypeScript** and **React** for customer-facing features.",
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

    expect(callProviderSpy).toHaveBeenCalledTimes(3);
    expect(result.cover.paragraphTwo).toContain("TypeScript");
    expect(result.reason).toBe("ai_ok");
    expect(result.promptMetaHash.cover).toMatch(/^[a-f0-9]{64}$/);
    expect(result.promptMetaHash.cover).not.toBe(
      buildPromptContentHash({
        target: "cover",
        ruleSetId: "rules-active-1",
        resumeSnapshotUpdatedAt: "unknown",
        locale: "en-AU",
        variant: "full",
        prompt: {
          instructions: expect.any(String),
          input: expect.stringContaining(
            "Generate a cover letter for this role",
          ),
        },
      }),
    );
  });

  it("uses fallback cover text when strict cover quality still fails", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.spyOn(providers, "callProvider")
      .mockResolvedValueOnce(RESUME_OUTPUT)
      .mockResolvedValueOnce(
        JSON.stringify({
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
          latestExperience: {
            addedBullets: ["Built TypeScript product features."],
          },
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
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
          latestExperience: {
            addedBullets: ["Built TypeScript product features."],
          },
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

    expect(callProviderSpy).toHaveBeenCalledTimes(3);
    expect(result.cvSummary).toBe("Reviewed TypeScript summary");
    expect(result.addedBullets).toEqual(["Built TypeScript product features."]);
    expect(result.reviewer).toMatchObject({ ran: true, revised: true });
    expect(result.promptMetaHash.resume).not.toBe(
      buildPromptContentHash({
        target: "resume",
        ruleSetId: "rules-active-1",
        resumeSnapshotUpdatedAt: "unknown",
        locale: "global",
        variant: "full",
        prompt: {
          instructions: expect.any(String),
          input: expect.stringContaining(
            "produce cvSummary and latestExperience.addedBullets",
          ),
        },
      }),
    );
    expect(result.promptMetaHash.cover).not.toBe(
      buildPromptContentHash({
        target: "cover",
        ruleSetId: "rules-active-1",
        resumeSnapshotUpdatedAt: "unknown",
        locale: "global",
        variant: "full",
        prompt: {
          instructions: expect.any(String),
          input: expect.stringContaining(
            "Generate a cover letter for this role",
          ),
        },
      }),
    );
  });

  it("fails closed when a required independent review is invalid", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.spyOn(providers, "callProvider")
      .mockResolvedValueOnce(
        JSON.stringify({
          cvSummary: "Initial summary",
          latestExperience: { addedBullets: [] },
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
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
