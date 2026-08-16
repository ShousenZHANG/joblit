import { describe, expect, it } from "vitest";

import {
  ManualGenerateSchema,
  masterSkillGroups,
  parseCoverManualOutput,
  parseCoverStrictOutput,
  parseResumeManualOutput,
  parseResumeStrictOutput,
  validateSkillsSelectionBounds,
} from "./manualImportParser";

const CV_SUMMARY =
  "Backend Engineer with production TypeScript and AWS experience, shipping " +
  "resilient services and observable delivery pipelines for high-traffic " +
  "platform teams across Australia.";

const resume = {
  cvSummary: CV_SUMMARY,
  skillsSelection: [
    { group: 0, items: [1, 0] },
    { group: 1, items: [0] },
  ],
};

const cover = {
  cover: {
    paragraphOne: "One",
    paragraphTwo: "Two",
    paragraphThree: "Three",
  },
};

const masterSkills = [
  { items: ["TypeScript", "Node.js"] },
  { items: ["AWS"] },
];

describe("manual import parser modes", () => {
  it("keeps legacy resume selection aliases, fences, and trailing-comma repair", () => {
    const result = parseResumeManualOutput(
      `\`\`\`json\n${JSON.stringify({
        cv_summary: CV_SUMMARY,
        skills_selection: [
          { group_index: 0, item_indexes: ["1", "0"] },
          { groupIndex: 1, itemIndexes: [0] },
        ],
      }).replace(/}$/, ",}")}\n\`\`\``,
    );

    expect(result.data).toEqual(resume);
  });

  it("drops a named skill rather than smuggling it past the index contract", () => {
    // Selection is index references only. A payload that writes skill names has
    // nothing index-shaped left, so it fails rather than introducing a skill
    // the candidate never wrote.
    const result = parseResumeManualOutput(
      JSON.stringify({
        cvSummary: CV_SUMMARY,
        skillsSelection: [{ group: 0, items: ["Rust", "Kubernetes"] }],
      }),
    );

    expect(result.data).toBeNull();
    expect(result.issues.length).toBeGreaterThan(0);
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
    [
      "snake_case alias",
      JSON.stringify({ ...resume, cvSummary: undefined, cv_summary: CV_SUMMARY }),
    ],
    ["trailing comma", `${JSON.stringify(resume).slice(0, -1)},}`],
    ["unknown key", JSON.stringify({ ...resume, prompt: "not allowed" })],
    ["a missing skills selection", JSON.stringify({ cvSummary: CV_SUMMARY })],
    [
      "retired latestExperience key",
      JSON.stringify({ ...resume, latestExperience: { addedBullets: ["Built APIs."] } }),
    ],
    [
      "retired skillsFinal key",
      JSON.stringify({ ...resume, skillsFinal: [{ label: "Backend", items: ["TypeScript"] }] }),
    ],
    [
      "a summary below the length window",
      JSON.stringify({ ...resume, cvSummary: "Backend engineer." }),
    ],
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

  it("accepts manual_import alone and rejects every retired source", () => {
    const base = {
      jobId: "550e8400-e29b-41d4-a716-446655440000",
      target: "resume",
      modelOutput: JSON.stringify(resume),
    } as const;
    expect(ManualGenerateSchema.parse(base).source).toBe("manual_import");
    // codex_batch went with the Runner: the only writer is the browser now.
    expect(
      ManualGenerateSchema.safeParse({ ...base, source: "codex_batch" }).success,
    ).toBe(false);
    expect(
      ManualGenerateSchema.safeParse({ ...base, source: "local_ai" }).success,
    ).toBe(false);
    expect(ManualGenerateSchema.safeParse({ ...base, userId: "attacker" }).success).toBe(false);
  });
});

describe("validateSkillsSelectionBounds", () => {
  it("accepts a selection that addresses only skills the candidate wrote", () => {
    expect(
      validateSkillsSelectionBounds(
        [
          { group: 0, items: [1, 0] },
          { group: 1, items: [0] },
        ],
        masterSkills,
      ),
    ).toBeNull();
  });

  it("rejects a group index past the end of the bank", () => {
    // The schema bounds the index structurally; only the profile knows that
    // group 2 does not exist, so the bank is the authority here.
    expect(
      validateSkillsSelectionBounds([{ group: 2, items: [0] }], masterSkills),
    ).toEqual({ kind: "group_out_of_range", group: 2 });
  });

  it("rejects an item index past the end of its group", () => {
    expect(
      validateSkillsSelectionBounds([{ group: 1, items: [0, 1] }], masterSkills),
    ).toEqual({ kind: "item_out_of_range", group: 1, item: 1 });
  });

  it("names the first out-of-range reference rather than the last", () => {
    expect(
      validateSkillsSelectionBounds(
        [
          { group: 0, items: [0] },
          { group: 5, items: [0] },
          { group: 9, items: [0] },
        ],
        masterSkills,
      ),
    ).toEqual({ kind: "group_out_of_range", group: 5 });
  });

  it("rejects every index when the candidate has no skills at all", () => {
    expect(validateSkillsSelectionBounds([{ group: 0, items: [0] }], [])).toEqual({
      kind: "group_out_of_range",
      group: 0,
    });
  });
});

describe("masterSkillGroups", () => {
  it("reads the stored profile's category groups", () => {
    expect(
      masterSkillGroups({
        skills: [{ category: "Languages", items: ["TypeScript", "Go"] }],
      }),
    ).toEqual([{ category: "Languages", items: ["TypeScript", "Go"] }]);
  });

  it("reads a legacy group that labels itself with label", () => {
    expect(
      masterSkillGroups({ skills: [{ label: "Cloud", items: ["AWS"] }] }),
    ).toEqual([{ category: "Cloud", items: ["AWS"] }]);
  });

  it("keeps group positions so an index still addresses the same group", () => {
    // The selection is positional. Dropping or reordering a group here would
    // silently repoint every index the model returned.
    expect(
      masterSkillGroups({
        skills: [
          { label: "Languages", items: ["TypeScript"] },
          { category: "Cloud", items: ["AWS", "Terraform"] },
        ],
      }),
    ).toEqual([
      { category: "Languages", items: ["TypeScript"] },
      { category: "Cloud", items: ["AWS", "Terraform"] },
    ]);
  });

  it("drops non-string items rather than exposing them as skills", () => {
    expect(
      masterSkillGroups({ skills: [{ category: "Mixed", items: ["AWS", 7, null] }] }),
    ).toEqual([{ category: "Mixed", items: ["AWS"] }]);
  });

  it("reads an empty bank from a profile with no skills", () => {
    expect(masterSkillGroups({})).toEqual([]);
    expect(masterSkillGroups(null)).toEqual([]);
    expect(masterSkillGroups({ skills: "not an array" })).toEqual([]);
  });
});
