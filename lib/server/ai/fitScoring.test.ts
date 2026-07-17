import { describe, expect, it } from "vitest";

import type { FitMatrix } from "@/lib/shared/schemas/fitMatrix";
import { aggregateFitMatrix, verdictForScore } from "./fitScoring";

function matrix(
  requirements: Array<[FitMatrix["requirements"][number]["type"], FitMatrix["requirements"][number]["judgement"]]>,
  eligibility: FitMatrix["eligibility"]["status"] = "PASS",
): FitMatrix {
  return {
    requirements: requirements.map(([type, judgement], index) => ({
      id: `r${index + 1}`,
      type,
      requirement: `requirement ${index + 1}`,
      judgement,
    })),
    eligibility: { status: eligibility, reasons: [] },
  };
}

describe("deterministic fit aggregation", () => {
  it("scores all-match as 100 STRONG and all-gap as 0 POOR", () => {
    expect(aggregateFitMatrix(matrix([["REQUIRED", "MATCH"], ["RESPONSIBILITY", "MATCH"]])))
      .toMatchObject({ score: 100, verdict: "STRONG" });
    expect(aggregateFitMatrix(matrix([["REQUIRED", "GAP"], ["RESPONSIBILITY", "GAP"]])))
      .toMatchObject({ score: 0, verdict: "POOR" });
  });

  it("weights REQUIRED above PREFERRED per spec", () => {
    const requiredGap = aggregateFitMatrix(
      matrix([["REQUIRED", "GAP"], ["PREFERRED", "MATCH"]]),
    );
    const preferredGap = aggregateFitMatrix(
      matrix([["REQUIRED", "MATCH"], ["PREFERRED", "GAP"]]),
    );
    expect(preferredGap.score).toBeGreaterThan(requiredGap.score);
    // 30/40 weight on the gap vs 10/40.
    expect(requiredGap.score).toBe(25);
    expect(preferredGap.score).toBe(75);
  });

  it("renormalises weights over the types actually present", () => {
    // Only PREFERRED present: a full match must still be 100, not 10/100.
    expect(aggregateFitMatrix(matrix([["PREFERRED", "MATCH"]])).score).toBe(100);
  });

  it("values PARTIAL and UNKNOWN between MATCH and GAP", () => {
    const partial = aggregateFitMatrix(matrix([["REQUIRED", "PARTIAL"]])).score;
    const unknown = aggregateFitMatrix(matrix([["REQUIRED", "UNKNOWN"]])).score;
    expect(partial).toBe(50);
    expect(unknown).toBe(25);
  });

  it("passes eligibility through without folding it into the score", () => {
    const result = aggregateFitMatrix(matrix([["REQUIRED", "MATCH"]], "BLOCK"));
    expect(result.score).toBe(100);
    expect(result.eligibility).toBe("BLOCK");
  });

  it("is deterministic for identical input", () => {
    const input = matrix([
      ["REQUIRED", "MATCH"],
      ["REQUIRED", "PARTIAL"],
      ["RESPONSIBILITY", "MATCH"],
      ["SENIORITY", "UNKNOWN"],
      ["DOMAIN", "GAP"],
    ]);
    expect(aggregateFitMatrix(input)).toEqual(aggregateFitMatrix(input));
  });

  it("maps verdict bands at the documented thresholds", () => {
    expect(verdictForScore(75)).toBe("STRONG");
    expect(verdictForScore(74)).toBe("GOOD");
    expect(verdictForScore(60)).toBe("GOOD");
    expect(verdictForScore(59)).toBe("MODERATE");
    expect(verdictForScore(45)).toBe("MODERATE");
    expect(verdictForScore(44)).toBe("WEAK");
    expect(verdictForScore(30)).toBe("WEAK");
    expect(verdictForScore(29)).toBe("POOR");
  });
});
