import type {
  FitJudgement,
  FitMatrix,
  FitRequirementType,
  FitVerdict,
} from "@/lib/shared/schemas/fitMatrix";

/**
 * Deterministic Role Fit aggregation (spec §7.5). The model only judges
 * individual requirements; the score, verdict, and eligibility surfaced to the
 * user come from this pure function so results are reproducible, explainable,
 * and identical across model runs.
 */

const TYPE_WEIGHTS: Record<FitRequirementType, number> = {
  REQUIRED: 30,
  RESPONSIBILITY: 25,
  SENIORITY: 15,
  PREFERRED: 10,
  DOMAIN: 10,
  CREDENTIAL: 10,
};

const JUDGEMENT_VALUES: Record<FitJudgement, number> = {
  MATCH: 1,
  PARTIAL: 0.5,
  // Unknown is uncertainty, not absence of fit; keep it above GAP but low.
  UNKNOWN: 0.25,
  GAP: 0,
};

export type FitScoreResult = {
  score: number;
  verdict: FitVerdict;
  eligibility: FitMatrix["eligibility"]["status"];
  /** Per-type average in [0,100] for the types present in the matrix. */
  typeScores: Partial<Record<FitRequirementType, number>>;
};

export function verdictForScore(score: number): FitVerdict {
  if (score >= 75) return "STRONG";
  if (score >= 60) return "GOOD";
  if (score >= 45) return "MODERATE";
  if (score >= 30) return "WEAK";
  return "POOR";
}

export function aggregateFitMatrix(matrix: FitMatrix): FitScoreResult {
  const buckets = new Map<FitRequirementType, number[]>();
  for (const requirement of matrix.requirements) {
    const values = buckets.get(requirement.type) ?? [];
    values.push(JUDGEMENT_VALUES[requirement.judgement]);
    buckets.set(requirement.type, values);
  }

  // A JD without e.g. explicit seniority or credential lines must not be
  // penalised for it: weights renormalise over the types actually present.
  let weightedSum = 0;
  let weightTotal = 0;
  const typeScores: Partial<Record<FitRequirementType, number>> = {};
  for (const [type, values] of buckets) {
    const average = values.reduce((sum, value) => sum + value, 0) / values.length;
    const typeScore = Math.round(average * 100);
    typeScores[type] = typeScore;
    weightedSum += typeScore * TYPE_WEIGHTS[type];
    weightTotal += TYPE_WEIGHTS[type];
  }

  const score = weightTotal > 0 ? Math.round(weightedSum / weightTotal) : 0;
  return {
    score,
    verdict: verdictForScore(score),
    eligibility: matrix.eligibility.status,
    typeScores,
  };
}
