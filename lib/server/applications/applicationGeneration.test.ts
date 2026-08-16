import { describe, expect, it } from "vitest";

import { acceptApplicationGeneration } from "./applicationGeneration";

const master = {
  candidate: {
    name: "Jane Doe",
    title: "Software Engineer",
    phone: "+61 400 000 000",
    email: "jane@example.com",
    linkedinUrl: "https://linkedin.com/in/jane",
    linkedinText: "linkedin.com/in/jane",
    githubUrl: undefined,
    githubText: undefined,
    websiteUrl: undefined,
    websiteText: undefined,
  },
  summary: "Base summary",
  skills: [
    { label: "Backend", items: ["Java", "Spring Boot"] },
    { label: "Platform", items: ["Linux", "Docker"] },
  ],
  experiences: [
    {
      title: "Engineer",
      company: "Acme",
      location: "Sydney",
      dates: "2022-2024",
      bullets: ["Built Java APIs.", "Maintained CI/CD pipelines on Linux."],
      links: [],
    },
  ],
  projects: [],
  education: [],
};

const profile = {
  basics: { fullName: "Jane Doe", title: "Engineer" },
  summary: "Delivered Java services and Linux CI/CD improvements.",
  experiences: [
    {
      title: "Engineer",
      company: "Acme",
      bullets: ["Built Java APIs.", "Maintained CI/CD pipelines on Linux."],
    },
  ],
  skills: [
    { label: "Backend", items: ["Java", "Spring Boot"] },
    { label: "Platform", items: ["Linux", "Docker"] },
  ],
};

const job = {
  title: "Software Engineer",
  company: "Example Co",
  description: "Build Java APIs and improve Linux CI/CD delivery.",
};

/** Names the role, claims no number and no skill the profile does not hold. */
const GOOD_SUMMARY =
  "Software Engineer delivering Java services and reliable Linux CI/CD " +
  "improvements for platform teams, with a focus on maintainable APIs and " +
  "dependable production delivery.";

const GOOD_SELECTION = [
  { group: 1, items: [0] },
  { group: 0, items: [0, 1] },
];

function resumeOutput(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    cvSummary: GOOD_SUMMARY,
    skillsSelection: GOOD_SELECTION,
    ...overrides,
  });
}

describe("acceptApplicationGeneration", () => {
  describe("the resume target", () => {
    it("persists the model's selection as the AI-owned half of the skills section", () => {
      const result = acceptApplicationGeneration({
        target: "resume",
        source: "manual_import",
        rawOutput: resumeOutput(),
        promptMetaHash: "prompt-hash",
        master,
        profile,
        job,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.aiContent.cv.skillsSelection).toEqual({
        aiSelection: GOOD_SELECTION,
      });
      // The user has made no choice yet, so there is nothing to restore to.
      expect(result.aiContent.cv.skillsSelection?.userSelection).toBeUndefined();
      expect(result.aiContent.cv.summary).toEqual({
        aiText: GOOD_SUMMARY,
        originalText: "Base summary",
        accepted: true,
      });
    });

    it("writes no experience bullets: tailoring changes the summary and the skill order only", () => {
      const result = acceptApplicationGeneration({
        target: "resume",
        source: "manual_import",
        rawOutput: resumeOutput(),
        promptMetaHash: "prompt-hash",
        master,
        profile,
        job,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.aiContent.cv).not.toHaveProperty("latestExperience");
      expect(Object.keys(result.aiContent.cv).sort()).toEqual([
        "skillsSelection",
        "summary",
      ]);
    });

    it("does not invent target provenance when a legacy manual receipt is unknown", () => {
      const result = acceptApplicationGeneration({
        target: "resume",
        source: "manual_import",
        rawOutput: resumeOutput(),
        promptMetaHash: "",
        master,
        profile,
        job,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.aiContent.promptMetaHash).toBe("");
      expect(result.aiContent.provenance).toBeUndefined();
    });

    it("accepts the strict current Resume contract for an internal provider", () => {
      const result = acceptApplicationGeneration({
        target: "resume",
        source: "server_batch",
        rawOutput: resumeOutput(),
        promptMetaHash: "server-prompt-hash",
        master,
        profile,
        job,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.aiContent.source).toBeUndefined();
      expect(result.aiContent.provenance?.resume).toEqual({
        generatedAt: result.aiContent.generatedAt,
        promptMetaHash: "server-prompt-hash",
        source: "server_batch",
      });
    });

    it("rejects a strict-source payload written in a manual dialect", () => {
      const result = acceptApplicationGeneration({
        target: "resume",
        source: "server_batch",
        rawOutput: JSON.stringify({
          cv_summary: GOOD_SUMMARY,
          skills_selection: GOOD_SELECTION,
        }),
        promptMetaHash: "server-prompt-hash",
        master,
        profile,
        job,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatchObject({
        status: 400,
        code: "INVALID_AI_RESULT",
      });
    });
  });

  describe("the summary lint", () => {
    it("rejects a summary that does not name the target role", () => {
      const result = acceptApplicationGeneration({
        target: "resume",
        source: "manual_import",
        rawOutput: resumeOutput({
          cvSummary:
            "Backend specialist delivering Java services and reliable Linux " +
            "CI/CD improvements for platform teams, with a focus on " +
            "maintainable APIs and dependable production delivery.",
        }),
        promptMetaHash: "prompt-hash",
        master,
        profile,
        job,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatchObject({
        status: 422,
        code: "SUMMARY_TITLE_MISSING",
      });
      expect(result.error.message).toContain("software engineer");
    });

    it("requires the role but not the seniority the posting asks for", () => {
      // A candidate may claim the role, not the rank.
      const result = acceptApplicationGeneration({
        target: "resume",
        source: "manual_import",
        rawOutput: resumeOutput(),
        promptMetaHash: "prompt-hash",
        master,
        profile,
        job: {
          ...job,
          title: "Senior Software Engineer - Platform (12 month contract)",
        },
      });

      expect(result.ok).toBe(true);
    });

    it("rejects a number the master profile cannot support", () => {
      // A tailored summary restates the candidate's record; it does not
      // discover new figures.
      const result = acceptApplicationGeneration({
        target: "resume",
        source: "manual_import",
        rawOutput: resumeOutput({
          cvSummary:
            "Software Engineer delivering Java services and reliable Linux " +
            "CI/CD improvements, cutting deployment time by 47% for platform " +
            "teams and keeping production delivery dependable.",
        }),
        promptMetaHash: "prompt-hash",
        master,
        profile,
        job,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatchObject({
        status: 422,
        code: "SUMMARY_UNGROUNDED_NUMBER",
      });
      expect(result.error.message).toContain("47%");
    });

    it("rejects a skill the master profile does not list", () => {
      const result = acceptApplicationGeneration({
        target: "resume",
        source: "manual_import",
        rawOutput: resumeOutput({
          cvSummary:
            "Software Engineer delivering Java and Kubernetes services with " +
            "reliable Linux CI/CD improvements for platform teams, focused on " +
            "maintainable APIs and dependable production delivery.",
        }),
        promptMetaHash: "prompt-hash",
        master,
        profile,
        job,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatchObject({
        status: 422,
        code: "SUMMARY_UNGROUNDED_SKILL",
      });
      expect(result.error.message).toContain("Kubernetes");
    });
  });

  describe("the skills selection bounds", () => {
    it("rejects a group index the candidate's skill bank does not have", () => {
      const result = acceptApplicationGeneration({
        target: "resume",
        source: "manual_import",
        rawOutput: resumeOutput({ skillsSelection: [{ group: 4, items: [0] }] }),
        promptMetaHash: "prompt-hash",
        master,
        profile,
        job,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatchObject({
        status: 400,
        code: "SKILLS_SELECTION_INVALID",
      });
      expect(result.error.message).toContain("skill group 4");
    });

    it("rejects an item index past the end of a real group", () => {
      const result = acceptApplicationGeneration({
        target: "resume",
        source: "manual_import",
        rawOutput: resumeOutput({ skillsSelection: [{ group: 0, items: [0, 9] }] }),
        promptMetaHash: "prompt-hash",
        master,
        profile,
        job,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatchObject({
        status: 400,
        code: "SKILLS_SELECTION_INVALID",
      });
      expect(result.error.message).toContain("item 9 of skill group 0");
    });

    it("checks the bounds before the summary, so an invented index is named first", () => {
      const result = acceptApplicationGeneration({
        target: "resume",
        source: "manual_import",
        rawOutput: resumeOutput({
          cvSummary:
            "Backend specialist delivering Java services and reliable Linux " +
            "CI/CD improvements for platform teams, with a focus on " +
            "maintainable APIs and dependable production delivery.",
          skillsSelection: [{ group: 4, items: [0] }],
        }),
        promptMetaHash: "prompt-hash",
        master,
        profile,
        job,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("SKILLS_SELECTION_INVALID");
    });
  });

  describe("the cover target", () => {
    it("reads legacy Cover headers from a manual import but keeps only canonical paragraphs", () => {
      const result = acceptApplicationGeneration({
        target: "cover",
        source: "manual_import",
        rawOutput: JSON.stringify({
          cover: {
            candidateTitle: "Injected title",
            subject: "Injected subject",
            date: "1 January 2030",
            salutation: "Injected salutation",
            paragraphOne: "One",
            paragraphTwo: "Two",
            paragraphThree: "Three",
            closing: "Injected closing",
            signatureName: "Injected name",
          },
        }),
        promptMetaHash: "manual-prompt-hash",
        master,
        profile,
        job,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.aiContent.cover).toEqual({
        paragraphOne: expect.objectContaining({ aiText: "One" }),
        paragraphTwo: expect.objectContaining({ aiText: "Two" }),
        paragraphThree: expect.objectContaining({ aiText: "Three" }),
      });
      expect(JSON.stringify(result.aiContent)).not.toContain("Injected");
    });

    it("carries no skills selection, so a cover import cannot retailor the resume", () => {
      const result = acceptApplicationGeneration({
        target: "cover",
        source: "manual_import",
        rawOutput: JSON.stringify({
          cover: {
            paragraphOne: "One",
            paragraphTwo: "Two",
            paragraphThree: "Three",
          },
        }),
        promptMetaHash: "manual-prompt-hash",
        master,
        profile,
        job,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.aiContent.cv.skillsSelection).toBeUndefined();
      expect(result.aiContent.cv.summary.accepted).toBe(false);
    });
  });
});
