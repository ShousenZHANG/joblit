import { describe, expect, it } from "vitest";

import { parseTailorOutput } from "./tailorParser";

describe("parseTailorOutput", () => {
  it("accepts the current resume delta contract, including zero added bullets", () => {
    expect(
      parseTailorOutput(
        JSON.stringify({
          cvSummary: "Grounded **platform** engineer.",
          latestExperience: { addedBullets: [] },
        }),
        "resume",
      ),
    ).toEqual({
      cvSummary: "Grounded **platform** engineer.",
      latestExperience: { addedBullets: [] },
    });
  });

  it("keeps the bounded v1 resume dialect usable from the manual UI", () => {
    expect(
      parseTailorOutput(
        JSON.stringify({
          cvSummary: "Summary",
          latestExperience: { bullets: ["Built grounded APIs"] },
          skillsFinal: [{ label: "Backend", items: ["TypeScript"] }],
        }),
        "resume",
      ),
    ).toEqual({
      cvSummary: "Summary",
      // The browser cannot diff against the authoritative Master Resume
      // Profile; the server acceptance seam derives additions on import.
      latestExperience: { addedBullets: [] },
    });
  });

  it("rejects malformed legacy resume output and more than three current additions", () => {
    expect(
      parseTailorOutput(
        JSON.stringify({
          cvSummary: "Summary",
          latestExperience: { bullets: [] },
          skillsFinal: [{ label: "Backend", items: [] }],
        }),
        "resume",
      ),
    ).toBeNull();
    expect(
      parseTailorOutput(
        JSON.stringify({
          cvSummary: "Summary",
          latestExperience: {
            addedBullets: ["one", "two", "three", "four"],
          },
        }),
        "resume",
      ),
    ).toBeNull();
  });

  it("enforces the shared current-contract text bounds before enabling import", () => {
    expect(
      parseTailorOutput(
        JSON.stringify({
          cvSummary: "x".repeat(2001),
          latestExperience: { addedBullets: [] },
        }),
        "resume",
      ),
    ).toBeNull();
    expect(
      parseTailorOutput(
        JSON.stringify({
          cvSummary: "Summary",
          latestExperience: { addedBullets: ["x".repeat(321)] },
        }),
        "resume",
      ),
    ).toBeNull();
    expect(
      parseTailorOutput(
        JSON.stringify({
          cover: {
            paragraphOne: "x".repeat(2001),
            paragraphTwo: "Evidence",
            paragraphThree: "Motivation",
          },
        }),
        "cover",
      ),
    ).toBeNull();
  });

  it("accepts current cover output and strips bounded v1 header metadata", () => {
    const current = {
      cover: {
        paragraphOne: "Intent",
        paragraphTwo: "Evidence",
        paragraphThree: "Motivation",
      },
    };
    expect(parseTailorOutput(JSON.stringify(current), "cover")).toEqual(current);
    expect(
      parseTailorOutput(
        JSON.stringify({
          cover: {
            ...current.cover,
            subject: "Legacy metadata",
          },
        }),
        "cover",
      ),
    ).toEqual(current);
  });
});
