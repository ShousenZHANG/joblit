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
  skills: [{ label: "Core", items: ["TypeScript"] }],
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
};

function makeCv(
  overrides: Partial<AiContent["cv"]> = {},
): AiContent["cv"] {
  return {
    summary: {
      aiText: "AI summary",
      originalText: "Master summary",
      accepted: true,
    },
    latestExperience: {
      experienceIndex: 0,
      addedBullets: [],
    },
    ...overrides,
  };
}

describe("composeApplicationResumeRenderInput", () => {
  it("keeps Master Resume Profile skills and applies canonical AI edits", () => {
    const cv = makeCv({
      summary: {
        aiText: "AI summary",
        originalText: "Master summary",
        userEdit: "Led **reliable** delivery & operations.",
        accepted: true,
      },
      latestExperience: {
        experienceIndex: 1,
        addedBullets: [
          {
            text: "Shipped **20%** faster.",
            accepted: true,
          },
          {
            text: "Rejected addition.",
            accepted: false,
          },
          {
            text: "Original accepted text.",
            userEdit: "User-edited addition & result.",
            accepted: true,
          },
        ],
      },
    });

    const result = composeApplicationResumeRenderInput({ master, cv });

    expect(result.skills).toEqual(master.skills);
    expect(result.summary).toBe(
      "Led \\textbf{reliable} delivery \\& operations.",
    );
    expect(result.experiences[0]).toEqual(master.experiences[0]);
    expect(result.experiences[1]?.bullets).toEqual([
      "Master bullet two",
      "Shipped \\textbf{20\\%} faster.",
      "User-edited addition \\& result.",
    ]);
  });

  it("falls back through AI text to the already-renderable Master summary", () => {
    const ai = composeApplicationResumeRenderInput({
      master,
      cv: makeCv(),
    });
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

  it("leaves experiences unchanged when experienceIndex is out of range", () => {
    const result = composeApplicationResumeRenderInput({
      master,
      cv: makeCv({
        latestExperience: {
          experienceIndex: 99,
          addedBullets: [{ text: "Accepted addition.", accepted: true }],
        },
      }),
    });

    expect(result.experiences).toEqual(master.experiences);
  });

  it("does not mutate either input", () => {
    const masterInput = structuredClone(master);
    const cv = makeCv({
      latestExperience: {
        experienceIndex: 0,
        addedBullets: [{ text: "Accepted addition.", accepted: true }],
      },
    });
    const cvInput = structuredClone(cv);

    composeApplicationResumeRenderInput({ master: masterInput, cv });

    expect(masterInput).toEqual(master);
    expect(cv).toEqual(cvInput);
  });
});
