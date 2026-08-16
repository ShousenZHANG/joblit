import { describe, expect, it } from "vitest";

import { parseTailorOutput } from "./tailorParser";

const SUMMARY =
  "Grounded platform engineer with eight years across Kubernetes, Go and TypeScript, shipping serverless data pipelines for Australian fintechs and holding full working rights.";

const RESUME_OUTPUT = {
  cvSummary: SUMMARY,
  skillsSelection: [
    { group: 0, items: [0, 2] },
    { group: 1, items: [1] },
  ],
};

const COVER_OUTPUT = {
  cover: {
    paragraphOne: "Intent",
    paragraphTwo: "Evidence",
    paragraphThree: "Motivation",
  },
};

describe("parseTailorOutput", () => {
  it("accepts the current resume contract", () => {
    expect(parseTailorOutput(JSON.stringify(RESUME_OUTPUT), "resume")).toEqual(
      RESUME_OUTPUT,
    );
  });

  it("accepts the current cover contract", () => {
    expect(parseTailorOutput(JSON.stringify(COVER_OUTPUT), "cover")).toEqual(
      COVER_OUTPUT,
    );
  });

  it("tolerates how a chatbot wraps its answer", () => {
    const wrapped = [
      "Here you go!",
      "```json",
      JSON.stringify(COVER_OUTPUT).replace(/"/g, "“").replace(/“(?=[,:}\]])/g, "”"),
      "```",
    ].join("\n");
    // Only the wrapping is repaired; the payload is unchanged.
    expect(parseTailorOutput(wrapped, "cover")).toEqual(COVER_OUTPUT);
    expect(
      parseTailorOutput(
        `Result:\n${JSON.stringify(RESUME_OUTPUT)},\n`,
        "resume",
      ),
    ).toEqual(RESUME_OUTPUT);
  });

  it("rejects a summary outside the shared length window", () => {
    expect(
      parseTailorOutput(
        JSON.stringify({ ...RESUME_OUTPUT, cvSummary: "Too short." }),
        "resume",
      ),
    ).toBeNull();
    expect(
      parseTailorOutput(
        JSON.stringify({ ...RESUME_OUTPUT, cvSummary: "x".repeat(351) }),
        "resume",
      ),
    ).toBeNull();
  });

  it("rejects retired keys rather than importing content the CV cannot carry", () => {
    expect(
      parseTailorOutput(
        JSON.stringify({
          ...RESUME_OUTPUT,
          latestExperience: { addedBullets: ["Built grounded APIs"] },
        }),
        "resume",
      ),
    ).toBeNull();
    expect(
      parseTailorOutput(
        JSON.stringify({
          cover: { ...COVER_OUTPUT.cover, subject: "Legacy metadata" },
        }),
        "cover",
      ),
    ).toBeNull();
  });

  it("rejects a skills selection that is empty or repeats a group", () => {
    expect(
      parseTailorOutput(
        JSON.stringify({ ...RESUME_OUTPUT, skillsSelection: [] }),
        "resume",
      ),
    ).toBeNull();
    expect(
      parseTailorOutput(
        JSON.stringify({
          ...RESUME_OUTPUT,
          skillsSelection: [
            { group: 0, items: [0] },
            { group: 0, items: [1] },
          ],
        }),
        "resume",
      ),
    ).toBeNull();
  });

  it("rejects the other document's payload", () => {
    expect(parseTailorOutput(JSON.stringify(COVER_OUTPUT), "resume")).toBeNull();
    expect(parseTailorOutput(JSON.stringify(RESUME_OUTPUT), "cover")).toBeNull();
    expect(parseTailorOutput("   ", "resume")).toBeNull();
  });
});
