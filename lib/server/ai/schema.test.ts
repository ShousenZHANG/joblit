import { describe, expect, it } from "vitest";

import { parseTailorModelOutput } from "./schema";

const CURRENT_OUTPUT = {
  cvSummary:
    "Platform engineer focused on reliable delivery, with six years running deployment automation and observability for a 200-service estate across two cloud providers.",
  skillsSelection: [
    { group: 0, items: [1, 0] },
    { group: 2, items: [3] },
  ],
  cover: {
    paragraphOne: "One",
    paragraphTwo: "Two",
    paragraphThree: "Three",
  },
};

describe("parseTailorModelOutput", () => {
  it("parses the canonical application generation contract", () => {
    const parsed = parseTailorModelOutput(JSON.stringify(CURRENT_OUTPUT));

    expect(parsed).toEqual(CURRENT_OUTPUT);
  });

  it("rejects generated experience text and author-written skills", () => {
    const parsed = parseTailorModelOutput(
      JSON.stringify({
        cvSummary: CURRENT_OUTPUT.cvSummary,
        latestExperience: { addedBullets: ["A proposed bullet"] },
        skillsFinal: [{ label: "Cloud", items: ["AWS"] }],
        cover: CURRENT_OUTPUT.cover,
      }),
    );

    expect(parsed).toBeNull();
  });

  it("rejects a selection that repeats a group or an index", () => {
    expect(
      parseTailorModelOutput(
        JSON.stringify({
          ...CURRENT_OUTPUT,
          skillsSelection: [
            { group: 0, items: [1] },
            { group: 0, items: [2] },
          ],
        }),
      ),
    ).toBeNull();
    expect(
      parseTailorModelOutput(
        JSON.stringify({
          ...CURRENT_OUTPUT,
          skillsSelection: [{ group: 0, items: [1, 1] }],
        }),
      ),
    ).toBeNull();
  });
});
