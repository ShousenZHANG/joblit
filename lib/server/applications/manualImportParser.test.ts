import { describe, expect, it } from "vitest";

import {
  ManualGenerateSchema,
  parseCoverManualOutput,
  parseCoverStrictOutput,
  parseResumeManualOutput,
  parseResumeStrictOutput,
} from "./manualImportParser";

const resume = {
  cvSummary: "Evidence-grounded engineer",
  latestExperience: { addedBullets: ["Built new production APIs."] },
};

const legacyResume = {
  cvSummary: "Evidence-grounded engineer",
  latestExperience: { bullets: ["Built production APIs."] },
  skillsFinal: [{ label: "Backend", items: ["TypeScript"] }],
};

const cover = {
  cover: {
    paragraphOne: "One",
    paragraphTwo: "Two",
    paragraphThree: "Three",
  },
};

describe("manual import parser modes", () => {
  it("keeps legacy resume aliases, fences, and trailing-comma repair", () => {
    const result = parseResumeManualOutput(
      `\`\`\`json\n${JSON.stringify({
        cv_summary: legacyResume.cvSummary,
        latest_experience: legacyResume.latestExperience,
        skills_final: [{ category: "Backend", items: ["TypeScript"] }],
      }).replace(/}$/, ",}")}\n\`\`\``,
    );

    expect(result.data).toEqual({
      cvSummary: legacyResume.cvSummary,
      latestExperience: legacyResume.latestExperience,
    });
  });

  it("keeps legacy flat cover aliases", () => {
    const result = parseCoverManualOutput(
      JSON.stringify({ paragraph_1: "One", paragraph_2: "Two", paragraph_3: "Three" }),
    );
    expect(result.data?.cover.paragraphTwo).toBe("Two");
  });

  it("reads legacy cover headers without exposing them as canonical content", () => {
    const result = parseCoverManualOutput(
      JSON.stringify({
        cover: {
          subject: "Legacy subject",
          salutation: "Legacy greeting",
          paragraphOne: "One",
          paragraphTwo: "Two",
          paragraphThree: "Three",
          closing: "Legacy closing",
          signatureName: "Legacy signature",
        },
      }),
    );

    expect(result.data).toEqual(cover);
  });

  it.each([
    ["fenced JSON", `\`\`\`json\n${JSON.stringify(resume)}\n\`\`\``],
    ["snake_case alias", JSON.stringify({ ...resume, cvSummary: undefined, cv_summary: "Alias" })],
    ["trailing comma", `${JSON.stringify(resume).slice(0, -1)},}`],
    ["unknown key", JSON.stringify({ ...resume, prompt: "not allowed" })],
    ["legacy full bullets", JSON.stringify(legacyResume)],
    ["retired skillsFinal key", JSON.stringify({ ...resume, skillsFinal: legacyResume.skillsFinal })],
    ["retired skillsAdditions key", JSON.stringify({ ...resume, skillsAdditions: [{ category: "Backend", items: ["TypeScript"] }] })],
  ])("strict resume rejects %s", (_label, raw) => {
    expect(parseResumeStrictOutput(raw).data).toBeNull();
  });

  it.each([
    ["flat aliases", JSON.stringify({ paragraphOne: "One", paragraphTwo: "Two", paragraphThree: "Three" })],
    ["snake_case aliases", JSON.stringify({ cover: { paragraph_1: "One", paragraph_2: "Two", paragraph_3: "Three" } })],
    ["unknown key", JSON.stringify({ ...cover, ignored: true })],
  ])("strict cover rejects %s", (_label, raw) => {
    expect(parseCoverStrictOutput(raw).data).toBeNull();
  });

  it("strict parsers accept only canonical JSON objects", () => {
    expect(parseResumeStrictOutput(JSON.stringify(resume)).data).toEqual(resume);
    expect(parseCoverStrictOutput(JSON.stringify(cover)).data).toEqual(cover);
  });

  it("defaults request source to manual_import and rejects over-posting", () => {
    const base = {
      jobId: "550e8400-e29b-41d4-a716-446655440000",
      target: "resume",
      modelOutput: JSON.stringify(resume),
    } as const;
    expect(ManualGenerateSchema.parse(base).source).toBe("manual_import");
    expect(
      ManualGenerateSchema.parse({ ...base, source: "codex_batch" }).source,
    ).toBe("codex_batch");
    expect(ManualGenerateSchema.safeParse({ ...base, userId: "attacker" }).success).toBe(false);
  });

});
