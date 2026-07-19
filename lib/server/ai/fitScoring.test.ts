import { describe, expect, it } from "vitest";

import type { FitMatrix } from "@/lib/shared/schemas/fitMatrix";
import { aggregateFitMatrix, verdictForScore } from "./fitScoring";

function matrix(
  requirements: Array<
    [
      FitMatrix["requirements"][number]["type"],
      FitMatrix["requirements"][number]["judgement"],
      FitMatrix["requirements"][number]["criticality"]?,
    ]
  >,
  eligibility: FitMatrix["eligibility"]["status"] = "PASS",
): FitMatrix {
  return {
    requirements: requirements.map(([type, judgement, criticality], index) => ({
      id: `r${index + 1}`,
      type,
      requirement: `requirement ${index + 1}`,
      judgement,
      ...(criticality ? { criticality } : {}),
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

  it("keeps PARTIAL and UNKNOWN in review range rather than treating uncertainty as a gap", () => {
    const partial = aggregateFitMatrix(matrix([["REQUIRED", "PARTIAL"]])).score;
    const unknown = aggregateFitMatrix(matrix([["REQUIRED", "UNKNOWN"]])).score;
    expect(partial).toBe(50);
    expect(unknown).toBe(50);
  });

  it("caps confirmed eligibility blocks so blocked jobs cannot rank as strong", () => {
    const result = aggregateFitMatrix(matrix([["REQUIRED", "MATCH"]], "BLOCK"));
    expect(result.rawScore).toBe(100);
    expect(result.score).toBe(29);
    expect(result.verdict).toBe("POOR");
    expect(result.eligibility).toBe("BLOCK");
    expect(result.gateStatus).toBe("BLOCKED");
    expect(result.gateCap).toBe(29);
  });

  it("caps explicit GATE gaps and leaves matched gates clear", () => {
    const blocked = aggregateFitMatrix(
      matrix([
        ["REQUIRED", "GAP", "GATE"],
        ["RESPONSIBILITY", "MATCH", "CORE"],
      ]),
    );
    expect(blocked.rawScore).toBeGreaterThan(29);
    expect(blocked.score).toBe(29);
    expect(blocked.gateStatus).toBe("BLOCKED");
    expect(blocked.criticalGaps).toHaveLength(1);

    const clear = aggregateFitMatrix(
      matrix([
        ["REQUIRED", "MATCH", "GATE"],
        ["RESPONSIBILITY", "MATCH", "CORE"],
      ]),
    );
    expect(clear).toMatchObject({
      score: 100,
      rawScore: 100,
      gateStatus: "CLEAR",
      gateCap: null,
    });
  });

  it("keeps uncertain or partial gates in manual-review range", () => {
    const unknown = aggregateFitMatrix(
      matrix([
        ["REQUIRED", "UNKNOWN", "GATE"],
        ["RESPONSIBILITY", "MATCH", "CORE"],
      ]),
    );
    expect(unknown.rawScore).toBeGreaterThan(59);
    expect(unknown.score).toBe(59);
    expect(unknown.gateStatus).toBe("REVIEW");
    expect(unknown.gateCap).toBe(59);
  });

  it("weights GATE evidence above supporting evidence within a type", () => {
    const result = aggregateFitMatrix(
      matrix([
        ["REQUIRED", "GAP", "GATE"],
        ["REQUIRED", "MATCH", "SUPPORTING"],
      ]),
    );
    expect(result.typeScores.REQUIRED).toBe(25);
  });

  it("deduplicates repeated requirements and keeps the conservative judgement", () => {
    const input: FitMatrix = {
      requirements: [
        {
          id: "r1",
          type: "REQUIRED",
          requirement: "Production Kubernetes experience",
          judgement: "MATCH",
          criticality: "CORE",
        },
        {
          id: "r2",
          type: "REQUIRED",
          requirement: " production  Kubernetes experience ",
          judgement: "GAP",
          criticality: "GATE",
        },
      ],
      eligibility: { status: "PASS", reasons: [] },
    };
    const result = aggregateFitMatrix(input);
    expect(result.typeScores.REQUIRED).toBe(0);
    expect(result.score).toBe(0);
    expect(result.criticalGaps).toHaveLength(1);
  });

  it.each([
    ["GATE/MATCH first", false],
    ["CORE/GAP first", true],
  ])(
    "merges duplicate criticality and judgement independently: %s",
    (_label, reverse) => {
      const duplicateRequirements: FitMatrix["requirements"] = [
        {
          id: "gate-match",
          type: "REQUIRED",
          requirement: "Production Kubernetes experience",
          judgement: "MATCH",
          criticality: "GATE",
        },
        {
          id: "core-gap",
          type: "REQUIRED",
          requirement: " production  kubernetes experience ",
          judgement: "GAP",
          criticality: "CORE",
        },
      ];
      const result = aggregateFitMatrix({
        requirements: reverse
          ? [...duplicateRequirements].reverse()
          : duplicateRequirements,
        eligibility: { status: "PASS", reasons: [] },
      });

      expect(result).toMatchObject({
        score: 0,
        gateStatus: "BLOCKED",
        gateCap: 29,
        typeScores: { REQUIRED: 0 },
      });
      expect(result.criticalGaps).toHaveLength(1);
      expect(result.criticalGaps[0]?.judgement).toBe("GAP");
    },
  );

  it("deduplicates non-Latin requirement text conservatively", () => {
    const result = aggregateFitMatrix({
      requirements: [
        {
          id: "cn-1",
          type: "REQUIRED",
          requirement: "需要 Kubernetes 生产经验",
          judgement: "MATCH",
          criticality: "GATE",
        },
        {
          id: "cn-2",
          type: "REQUIRED",
          requirement: " 需要 Kubernetes 生产经验 ",
          judgement: "GAP",
          criticality: "CORE",
        },
      ],
      eligibility: { status: "PASS", reasons: [] },
    });

    expect(result).toMatchObject({ score: 0, gateStatus: "BLOCKED" });
    expect(result.criticalGaps).toHaveLength(1);
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
