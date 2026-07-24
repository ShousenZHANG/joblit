import { describe, expect, it } from "vitest";

import { parseTailorModelOutput } from "./schema";

describe("parseTailorModelOutput", () => {
  it("parses the canonical application generation contract", () => {
    const parsed = parseTailorModelOutput(
      JSON.stringify({
        cvSummary: "Platform engineer focused on reliable delivery.",
        latestExperience: {
          addedBullets: [
            "Built deployment automation grounded in the candidate evidence.",
          ],
        },
        cover: {
          paragraphOne: "One",
          paragraphTwo: "Two",
          paragraphThree: "Three",
        },
      }),
    );

    expect(parsed).toEqual({
      cvSummary: "Platform engineer focused on reliable delivery.",
      latestExperience: {
        addedBullets: [
          "Built deployment automation grounded in the candidate evidence.",
        ],
      },
      cover: {
        paragraphOne: "One",
        paragraphTwo: "Two",
        paragraphThree: "Three",
      },
    });
  });

  it("rejects the retired full-list and skills contract", () => {
    const parsed = parseTailorModelOutput(
      JSON.stringify({
        cvSummary: "Legacy",
        latestExperience: { bullets: ["Base bullet"] },
        skillsFinal: [{ label: "Cloud", items: ["AWS"] }],
        cover: {
          paragraphOne: "One",
          paragraphTwo: "Two",
          paragraphThree: "Three",
        },
      }),
    );

    expect(parsed).toBeNull();
  });
});
