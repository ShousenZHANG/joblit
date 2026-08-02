import { describe, expect, it } from "vitest";

import { parseStructuralRequirements } from "./structuralRequirementParser";

describe("parseStructuralRequirements", () => {
  it("does not misclassify offered sponsorship as a work-rights gate", () => {
    expect(
      parseStructuralRequirements(
        "Benefits include visa sponsorship available for the right candidate.",
      ),
    ).toEqual([]);
  });

  it("keeps degree-or-equivalent language out of hard-gate status", () => {
    expect(
      parseStructuralRequirements(
        "Required: Bachelor's degree or equivalent experience in software engineering.",
      )[0],
    ).toMatchObject({
      label: "Preferred: Bachelor's degree or equivalent experience",
      isRequired: false,
    });
  });

  it("marks an explicitly mandatory on-site mode as required", () => {
    expect(
      parseStructuralRequirements(
        "You must work on-site three days per week.",
      )[0],
    ).toMatchObject({ label: "Required: On-site", isRequired: true });
  });

  it("drops explicitly negated clearance requirements", () => {
    expect(
      parseStructuralRequirements("Security clearance is not required."),
    ).toEqual([]);
  });

  it("keeps preferred citizenship out of hard-gate status", () => {
    expect(
      parseStructuralRequirements("Australian citizenship preferred."),
    ).toEqual([
      expect.objectContaining({
        label: "Preferred: Work rights required",
        evidence: "Australian citizenship preferred",
        isRequired: false,
      }),
    ]);
  });

  it("never turns experience years into a pre-scan screening gate", () => {
    expect(
      parseStructuralRequirements(
        "Requirements:\nAt least 5 years of professional experience required.",
      ),
    ).toEqual([]);
  });
});
