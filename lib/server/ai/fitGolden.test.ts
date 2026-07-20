import { describe, expect, it } from "vitest";
import { evaluateGoldenSet, type GoldenCase } from "./fitGolden";
import type { FitMatrix } from "@/lib/shared/schemas/fitMatrix";

function matrix(overrides?: {
  eligibility?: FitMatrix["eligibility"]["status"];
  judgement?: FitMatrix["requirements"][number]["judgement"];
}): FitMatrix {
  return {
    requirements: [
      {
        id: "r1",
        type: "REQUIRED",
        requirement: "Python",
        judgement: overrides?.judgement ?? "MATCH",
        criticality: "CORE",
      },
    ],
    eligibility: { status: overrides?.eligibility ?? "PASS", reasons: [] },
  };
}

function caseWith(id: string, reference: FitMatrix): GoldenCase {
  return { id, title: `case ${id}`, note: "", reference };
}

describe("evaluateGoldenSet", () => {
  it("reports full agreement when the candidate reproduces every reference", () => {
    const cases = [caseWith("a", matrix()), caseWith("b", matrix())];
    const report = evaluateGoldenSet({
      cases,
      replays: { a: matrix(), b: matrix() },
    });

    expect(report.total).toBe(2);
    expect(report.eligibilityAgreement).toBe(1);
    expect(report.scoreAgreement).toBe(1);
    expect(report.disagreements).toEqual([]);
    expect(report.passed).toBe(true);
  });

  it("treats eligibility as the gate and fails below the threshold", () => {
    const cases = [
      caseWith("a", matrix({ eligibility: "PASS" })),
      caseWith("b", matrix({ eligibility: "PASS" })),
    ];
    const report = evaluateGoldenSet({
      cases,
      replays: {
        a: matrix({ eligibility: "PASS" }),
        b: matrix({ eligibility: "BLOCK" }),
      },
      minEligibilityAgreement: 0.8,
    });

    expect(report.eligibilityAgreement).toBe(0.5);
    expect(report.passed).toBe(false);
    expect(report.disagreements).toContainEqual({
      id: "b",
      field: "eligibility",
      expected: "PASS",
      actual: "BLOCK",
    });
  });

  it("does not let a score drift alone fail the gate", () => {
    // Score is profile-relative and noisy; eligibility is the clean 0/1 signal.
    // A candidate that agrees on eligibility still passes.
    const cases = [caseWith("a", matrix({ judgement: "MATCH" }))];
    const report = evaluateGoldenSet({
      cases,
      replays: { a: matrix({ judgement: "GAP" }) },
      scoreTolerance: 5,
    });

    expect(report.eligibilityAgreement).toBe(1);
    expect(report.scoreAgreement).toBe(0);
    expect(report.passed).toBe(true);
  });

  it("counts a score inside the tolerance band as agreement", () => {
    const reference: FitMatrix = {
      requirements: [
        { id: "r1", type: "REQUIRED", requirement: "A", judgement: "MATCH", criticality: "CORE" },
        { id: "r2", type: "REQUIRED", requirement: "B", judgement: "MATCH", criticality: "CORE" },
      ],
      eligibility: { status: "PASS", reasons: [] },
    };
    const candidate: FitMatrix = {
      requirements: [
        { id: "r1", type: "REQUIRED", requirement: "A", judgement: "MATCH", criticality: "CORE" },
        { id: "r2", type: "REQUIRED", requirement: "B", judgement: "MATCH", criticality: "SUPPORTING" },
      ],
      eligibility: { status: "PASS", reasons: [] },
    };

    const report = evaluateGoldenSet({
      cases: [caseWith("a", reference)],
      replays: { a: candidate },
      scoreTolerance: 5,
    });

    expect(report.scoreAgreement).toBe(1);
  });

  it("counts a missing replay as a disagreement rather than silent credit", () => {
    const report = evaluateGoldenSet({
      cases: [caseWith("a", matrix()), caseWith("b", matrix())],
      replays: { a: matrix() },
    });

    expect(report.missingReplays).toEqual(["b"]);
    expect(report.eligibilityAgreement).toBe(0.5);
    expect(report.disagreements).toContainEqual({
      id: "b",
      field: "replay",
      expected: "present",
      actual: "missing",
    });
  });

  it("rejects a replay that is not a valid fit matrix", () => {
    const report = evaluateGoldenSet({
      cases: [caseWith("a", matrix())],
      replays: { a: { requirements: [], eligibility: { status: "PASS", reasons: [] } } as unknown as FitMatrix },
    });

    expect(report.passed).toBe(false);
    expect(report.disagreements[0]).toMatchObject({ id: "a", field: "replay" });
  });

  it("reports zero agreement without crashing on an empty case set", () => {
    const report = evaluateGoldenSet({ cases: [], replays: {} });

    expect(report.total).toBe(0);
    expect(report.eligibilityAgreement).toBe(0);
    expect(report.passed).toBe(false);
  });
});
