import { describe, expect, it } from "vitest";

import { parseExperienceGate } from "./experienceParser";

describe("parseExperienceGate", () => {
  it("does not misclassify offered sponsorship as a work-rights gate", () => {
    expect(
      parseExperienceGate(
        "Benefits include visa sponsorship available for the right candidate.",
      ),
    ).toEqual([]);
  });

  it("keeps degree-or-equivalent language out of hard-gate status", () => {
    const signals = parseExperienceGate(
      "Required: Bachelor's degree or equivalent experience in software engineering.",
    );
    expect(signals[0]).toMatchObject({
      label: "Preferred: Bachelor's degree or equivalent experience",
      isRequired: false,
    });
  });

  it("marks an explicitly mandatory on-site mode as required", () => {
    const signals = parseExperienceGate(
      "You must work on-site three days per week.",
    );
    expect(signals[0]).toMatchObject({
      label: "Required: On-site",
      isRequired: true,
    });
  });

  it("drops explicitly negated clearance requirements", () => {
    expect(
      parseExperienceGate("Security clearance is not required."),
    ).toEqual([]);
  });

  it("keeps preferred citizenship out of hard-gate status", () => {
    expect(
      parseExperienceGate("Australian citizenship preferred."),
    ).toEqual([
      expect.objectContaining({
        label: "Preferred: Work rights required",
        evidence: "Australian citizenship preferred",
        isRequired: false,
      }),
    ]);
  });

  it("preserves newline boundaries when bullets have no punctuation", () => {
    const signals = parseExperienceGate(
      [
        "Security clearance is not required",
        "Australian citizenship preferred",
        "At least 5 years of professional experience required",
      ].join("\n"),
    );

    expect(signals).toHaveLength(2);
    expect(signals[0]).toMatchObject({
      label: "Required: 5+ years",
      evidence: "At least 5 years of professional experience required",
      isRequired: true,
    });
    expect(signals[1]).toMatchObject({
      label: "Preferred: Work rights required",
      evidence: "Australian citizenship preferred",
      isRequired: false,
    });
    expect(
      signals.some(({ label }) => label.includes("Security clearance")),
    ).toBe(false);
  });
});

describe("competing experience thresholds", () => {
  it("folds a preferred year count into the required one", () => {
    // A JD that requires two years and prefers five states one hiring bar, not
    // two. Emitting both left the reader reconciling a "2+ years" gate against
    // a "5+ years" preference shown in a different group.
    const signals = parseExperienceGate(
      "Minimum 2 years of commercial experience is required. 5+ years experience preferred.",
    );

    const years = signals.filter((signal) => signal.minYears > 0);
    expect(years).toHaveLength(1);
    expect(years[0].isRequired).toBe(true);
    expect(years[0].shortLabel).toBe("2+ years (5+ preferred)");
  });

  it("leaves a lone preferred threshold alone", () => {
    const signals = parseExperienceGate("5+ years experience preferred.");
    const years = signals.filter((signal) => signal.minYears > 0);

    expect(years).toHaveLength(1);
    expect(years[0].isRequired).toBe(false);
    expect(years[0].shortLabel).toBe("5+ years");
  });

  it("keeps a required threshold untouched when nothing is preferred", () => {
    const signals = parseExperienceGate("Minimum 3 years of experience required.");
    const years = signals.filter((signal) => signal.minYears > 0);

    expect(years).toHaveLength(1);
    expect(years[0].shortLabel).toBe("3+ years");
  });

  it("does not fold a preference that asks for less than the requirement", () => {
    // Nonsense pairing in a real posting; surfacing the requirement alone is
    // safer than inventing a range that reads backwards.
    const signals = parseExperienceGate(
      "Minimum 5 years experience required. 2+ years preferred.",
    );
    const years = signals.filter((signal) => signal.minYears > 0);

    expect(years).toHaveLength(1);
    expect(years[0].shortLabel).toBe("5+ years");
  });
});
