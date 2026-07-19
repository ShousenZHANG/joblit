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
