import { FitMatrixSchema, type FitMatrix } from "@/lib/shared/schemas/fitMatrix";
import { aggregateFitMatrix } from "@/lib/server/ai/fitScoring";

// Golden-set harness for the fit pipeline.
//
// The pipeline has two halves: a model produces a requirement matrix, and
// Joblit aggregates that matrix into a score deterministically. The aggregator
// is already unit-tested. What has had no regression signal is the half that
// drifts — swapping models, lowering reasoning effort, or editing the prompt
// could silently change every verdict and nothing would fail.
//
// This measures AGREEMENT WITH A FROZEN REFERENCE, not absolute correctness.
// For the question actually being asked — "can this cheaper or local model
// hold this task?" — distance to the reference is exactly the right metric.
//
// Eligibility is the gate: it is a property of the JD plus hard constraints,
// so it is reproducible and profile-independent. Score is profile-relative and
// noisy, so it is reported with a tolerance band but never fails the run.

export interface GoldenCase {
  id: string;
  title: string;
  /** Why this case is in the set — usually which edge it probes. */
  note: string;
  /** Frozen reference matrix: the verdict a premium model produced. */
  reference: FitMatrix;
}

export interface GoldenDisagreement {
  id: string;
  field: "eligibility" | "score" | "replay";
  expected: string;
  actual: string;
}

export interface GoldenReport {
  total: number;
  /** Fraction of cases whose eligibility matched exactly. Gates the run. */
  eligibilityAgreement: number;
  /** Fraction whose score landed inside the tolerance band. Reported only. */
  scoreAgreement: number;
  missingReplays: string[];
  disagreements: GoldenDisagreement[];
  passed: boolean;
}

export const DEFAULT_SCORE_TOLERANCE = 5;
export const DEFAULT_MIN_ELIGIBILITY_AGREEMENT = 0.8;

export function evaluateGoldenSet(input: {
  cases: GoldenCase[];
  replays: Record<string, FitMatrix>;
  scoreTolerance?: number;
  minEligibilityAgreement?: number;
}): GoldenReport {
  const tolerance = input.scoreTolerance ?? DEFAULT_SCORE_TOLERANCE;
  const minAgreement =
    input.minEligibilityAgreement ?? DEFAULT_MIN_ELIGIBILITY_AGREEMENT;

  const disagreements: GoldenDisagreement[] = [];
  const missingReplays: string[] = [];
  let eligibilityHits = 0;
  let scoreHits = 0;

  for (const goldenCase of input.cases) {
    const replay = input.replays[goldenCase.id];
    if (!replay) {
      missingReplays.push(goldenCase.id);
      disagreements.push({
        id: goldenCase.id,
        field: "replay",
        expected: "present",
        actual: "missing",
      });
      continue;
    }

    // A malformed replay is a failure, not a skip: a model that cannot produce
    // a valid matrix cannot hold the task.
    const parsed = FitMatrixSchema.safeParse(replay);
    if (!parsed.success) {
      disagreements.push({
        id: goldenCase.id,
        field: "replay",
        expected: "valid fit matrix",
        actual: parsed.error.issues[0]?.message ?? "invalid",
      });
      continue;
    }

    const expected = aggregateFitMatrix(goldenCase.reference);
    const actual = aggregateFitMatrix(parsed.data);

    if (expected.eligibility === actual.eligibility) {
      eligibilityHits += 1;
    } else {
      disagreements.push({
        id: goldenCase.id,
        field: "eligibility",
        expected: expected.eligibility,
        actual: actual.eligibility,
      });
    }

    if (Math.abs(expected.score - actual.score) <= tolerance) {
      scoreHits += 1;
    } else {
      disagreements.push({
        id: goldenCase.id,
        field: "score",
        expected: String(expected.score),
        actual: String(actual.score),
      });
    }
  }

  const total = input.cases.length;
  const eligibilityAgreement = total === 0 ? 0 : eligibilityHits / total;
  const scoreAgreement = total === 0 ? 0 : scoreHits / total;

  return {
    total,
    eligibilityAgreement,
    scoreAgreement,
    missingReplays,
    disagreements,
    passed: total > 0 && eligibilityAgreement >= minAgreement,
  };
}

/** Human-readable one-liner for CI output. */
export function formatGoldenReport(model: string, report: GoldenReport): string {
  const pct = (value: number) => `${Math.round(value * 100)}%`;
  return [
    `model=${model}`,
    `cases=${report.total}`,
    `eligibility=${pct(report.eligibilityAgreement)}`,
    `score=${pct(report.scoreAgreement)}`,
    `verdict=${report.passed ? "PASS" : "FAIL"}`,
  ].join(" ");
}
