import { describe, expect, it } from "vitest";
import type { AiContent } from "@/lib/shared/schemas/aiContent";
import { composeApplicationResumeRenderInput } from "./applicationResumeComposition";

const master = {
  candidate: {
    name: "Jane Doe",
    title: "Engineer",
    email: "jane@example.com",
    phone: "+61 400 000 000",
    linkedinUrl: undefined,
    linkedinText: undefined,
    githubUrl: undefined,
    githubText: undefined,
    websiteUrl: undefined,
    websiteText: undefined,
  },
  summary: "Master summary",
  skills: [
    { label: "Core", items: ["TypeScript", "Node.js"] },
    { label: "Cloud", items: ["AWS", "Terraform"] },
  ],
  experiences: [
    {
      title: "Engineer",
      company: "Acme",
      location: "Sydney",
      dates: "2022-2024",
      bullets: ["Master bullet one"],
      links: [],
    },
    {
      title: "Developer",
      company: "Example",
      location: "Melbourne",
      dates: "2020-2022",
      bullets: ["Master bullet two"],
      links: [],
    },
  ],
  projects: [],
  education: [],
  certifications: [],
};

function makeCv(overrides: Partial<AiContent["cv"]> = {}): AiContent["cv"] {
  return {
    summary: {
      aiText: "AI summary",
      originalText: "Master summary",
      accepted: true,
    },
    ...overrides,
  };
}

describe("composeApplicationResumeRenderInput", () => {
  it("applies the canonical summary edit and escapes it for LaTeX", () => {
    const result = composeApplicationResumeRenderInput({
      master,
      cv: makeCv({
        summary: {
          aiText: "AI summary",
          originalText: "Master summary",
          userEdit: "Led **reliable** delivery & operations.",
          accepted: true,
        },
      }),
    });

    expect(result.summary).toBe(
      "Led \\textbf{reliable} delivery \\& operations.",
    );
  });

  it("falls back through AI text to the already-renderable Master summary", () => {
    const ai = composeApplicationResumeRenderInput({ master, cv: makeCv() });
    expect(ai.summary).toBe("AI summary");

    const fallback = composeApplicationResumeRenderInput({
      master,
      cv: makeCv({
        summary: {
          aiText: "   ",
          originalText: "Master summary",
          accepted: true,
        },
      }),
    });
    expect(fallback.summary).toBe("Master summary");
  });

  it("renders the Master Resume Profile's skills when there is no selection", () => {
    // A draft written before tailoring selected skills keeps rendering the
    // document it already rendered.
    const result = composeApplicationResumeRenderInput({ master, cv: makeCv() });

    expect(result.skills).toEqual(master.skills);
  });

  it("narrows and reorders the skills the selection addresses", () => {
    const result = composeApplicationResumeRenderInput({
      master,
      cv: makeCv({
        skillsSelection: {
          aiSelection: [
            { group: 1, items: [1, 0] },
            { group: 0, items: [0] },
          ],
        },
      }),
    });

    expect(result.skills).toEqual([
      { label: "Cloud", items: ["Terraform", "AWS"] },
      { label: "Core", items: ["TypeScript"] },
    ]);
  });

  it("renders the user's narrowed selection over the AI's", () => {
    const result = composeApplicationResumeRenderInput({
      master,
      cv: makeCv({
        skillsSelection: {
          aiSelection: [{ group: 0, items: [0, 1] }],
          userSelection: [{ group: 1, items: [0] }],
        },
      }),
    });

    expect(result.skills).toEqual([{ label: "Cloud", items: ["AWS"] }]);
  });

  it("adds no skill the Master Resume Profile does not already hold", () => {
    // The selection carries indexes only, so resolving it can never introduce
    // a string the candidate did not write.
    const result = composeApplicationResumeRenderInput({
      master,
      cv: makeCv({
        skillsSelection: {
          aiSelection: [
            { group: 0, items: [0, 1] },
            { group: 1, items: [0, 1] },
          ],
        },
      }),
    });

    const owned = new Set(master.skills.flatMap((group) => group.items));
    for (const group of result.skills) {
      for (const item of group.items) expect(owned.has(item)).toBe(true);
    }
  });

  it("drops a selection reference the profile no longer resolves", () => {
    // A profile edit between generation and finalize is normal; the render
    // context fence un-publishes the document, so this renders what survives.
    const result = composeApplicationResumeRenderInput({
      master,
      cv: makeCv({
        skillsSelection: {
          aiSelection: [
            { group: 7, items: [0] },
            { group: 0, items: [0, 5] },
          ],
        },
      }),
    });

    expect(result.skills).toEqual([{ label: "Core", items: ["TypeScript"] }]);
  });

  it("leaves every experience exactly as the candidate wrote it", () => {
    // Tailoring writes no bullets. The master profile owns the experience
    // section outright.
    const result = composeApplicationResumeRenderInput({
      master,
      cv: makeCv({
        summary: {
          aiText: "AI summary",
          originalText: "Master summary",
          userEdit: "Edited summary.",
          accepted: true,
        },
        skillsSelection: { aiSelection: [{ group: 0, items: [1] }] },
      }),
    });

    expect(result.experiences).toEqual(master.experiences);
    expect(result.projects).toEqual(master.projects);
    expect(result.education).toEqual(master.education);
  });

  it("does not mutate either input", () => {
    const masterInput = structuredClone(master);
    const cv = makeCv({
      skillsSelection: {
        aiSelection: [{ group: 1, items: [0] }],
        userSelection: [{ group: 0, items: [0] }],
      },
    });
    const cvInput = structuredClone(cv);

    composeApplicationResumeRenderInput({ master: masterInput, cv });

    expect(masterInput).toEqual(master);
    expect(cv).toEqual(cvInput);
  });
});
