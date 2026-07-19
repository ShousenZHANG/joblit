import type {
  FitCriticality,
  FitJudgement,
  FitMatrix,
  FitRequirementCategory,
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
  // Unknown is uncertainty, not a demonstrated gap. Keep it in review range.
  UNKNOWN: 0.5,
  GAP: 0,
};

const CRITICALITY_WEIGHTS: Record<FitCriticality, number> = {
  GATE: 2,
  CORE: 1,
  SUPPORTING: 0.65,
};

const JUDGEMENT_SEVERITY: Record<FitJudgement, number> = {
  GAP: 4,
  UNKNOWN: 3,
  PARTIAL: 2,
  MATCH: 1,
};

export type FitGapSummary = {
  id: string;
  requirement: string;
  judgement: FitJudgement;
  category?: FitRequirementCategory;
};

export type FitGateStatus = "CLEAR" | "REVIEW" | "BLOCKED";

export type FitScoreResult = {
  score: number;
  /** Weighted score before deterministic hard-gate caps. */
  rawScore: number;
  verdict: FitVerdict;
  eligibility: FitMatrix["eligibility"]["status"];
  gateStatus: FitGateStatus;
  /** Null when no GATE cap changed ranking score. */
  gateCap: 29 | 59 | null;
  criticalGaps: FitGapSummary[];
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

function defaultCriticality(type: FitRequirementType): FitCriticality {
  return type === "PREFERRED" ? "SUPPORTING" : "CORE";
}

function normalizedRequirementKey(
  requirement: FitMatrix["requirements"][number],
): string {
  return requirement.requirement
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}+#.]+/gu, " ")
    .trim();
}

/**
 * Models occasionally repeat a requirement with different ids. Keep the most
 * critical and most conservative judgement so repetition cannot inflate fit.
 */
function deduplicateRequirements(
  requirements: FitMatrix["requirements"],
): FitMatrix["requirements"] {
  type Requirement = FitMatrix["requirements"][number];
  type RequirementAccumulator = {
    representative: Requirement;
    criticality: FitCriticality;
    judgement: FitJudgement;
  };

  const representativeFingerprint = (requirement: Requirement) =>
    [
      requirement.id,
      requirement.type,
      requirement.category ?? "",
      requirement.requirement,
      requirement.jdEvidence ?? requirement.evidence ?? "",
      requirement.candidateEvidence ?? "",
      requirement.note ?? "",
    ].join("\u0000");

  const preferRepresentative = (
    incoming: Requirement,
    existing: Requirement,
  ): boolean => {
    const incomingCriticality =
      incoming.criticality ?? defaultCriticality(incoming.type);
    const existingCriticality =
      existing.criticality ?? defaultCriticality(existing.type);
    return (
      CRITICALITY_WEIGHTS[incomingCriticality] >
        CRITICALITY_WEIGHTS[existingCriticality] ||
      (CRITICALITY_WEIGHTS[incomingCriticality] ===
        CRITICALITY_WEIGHTS[existingCriticality] &&
        (JUDGEMENT_SEVERITY[incoming.judgement] >
          JUDGEMENT_SEVERITY[existing.judgement] ||
          (JUDGEMENT_SEVERITY[incoming.judgement] ===
            JUDGEMENT_SEVERITY[existing.judgement] &&
            (TYPE_WEIGHTS[incoming.type] > TYPE_WEIGHTS[existing.type] ||
              (TYPE_WEIGHTS[incoming.type] === TYPE_WEIGHTS[existing.type] &&
                representativeFingerprint(incoming).localeCompare(
                  representativeFingerprint(existing),
                  "en",
                ) < 0)))))
    );
  };

  const unique = new Map<string, RequirementAccumulator>();
  for (const requirement of requirements) {
    const key = normalizedRequirementKey(requirement) || requirement.id;
    const existing = unique.get(key);
    if (!existing) {
      unique.set(key, {
        representative: requirement,
        criticality:
          requirement.criticality ?? defaultCriticality(requirement.type),
        judgement: requirement.judgement,
      });
      continue;
    }

    const incomingCriticality =
      requirement.criticality ?? defaultCriticality(requirement.type);
    if (
      CRITICALITY_WEIGHTS[incomingCriticality] >
      CRITICALITY_WEIGHTS[existing.criticality]
    ) {
      existing.criticality = incomingCriticality;
    }
    if (
      JUDGEMENT_SEVERITY[requirement.judgement] >
      JUDGEMENT_SEVERITY[existing.judgement]
    ) {
      existing.judgement = requirement.judgement;
    }
    if (preferRepresentative(requirement, existing.representative)) {
      existing.representative = requirement;
    }
  }

  return [...unique.values()].map(
    ({ representative, criticality, judgement }) => ({
      ...representative,
      criticality,
      judgement,
    }),
  );
}

export function aggregateFitMatrix(matrix: FitMatrix): FitScoreResult {
  const requirements = deduplicateRequirements(matrix.requirements);
  const buckets = new Map<
    FitRequirementType,
    Array<{ value: number; weight: number }>
  >();
  for (const requirement of requirements) {
    const values = buckets.get(requirement.type) ?? [];
    values.push({
      value: JUDGEMENT_VALUES[requirement.judgement],
      weight:
        CRITICALITY_WEIGHTS[
          requirement.criticality ?? defaultCriticality(requirement.type)
        ],
    });
    buckets.set(requirement.type, values);
  }

  // A JD without e.g. explicit seniority or credential lines must not be
  // penalised for it: weights renormalise over the types actually present.
  let weightedSum = 0;
  let weightTotal = 0;
  const typeScores: Partial<Record<FitRequirementType, number>> = {};
  for (const [type, values] of buckets) {
    const totalCriticalityWeight = values.reduce(
      (sum, value) => sum + value.weight,
      0,
    );
    const average =
      values.reduce((sum, value) => sum + value.value * value.weight, 0) /
      totalCriticalityWeight;
    const typeScore = Math.round(average * 100);
    typeScores[type] = typeScore;
    weightedSum += typeScore * TYPE_WEIGHTS[type];
    weightTotal += TYPE_WEIGHTS[type];
  }

  const rawScore =
    weightTotal > 0 ? Math.round(weightedSum / weightTotal) : 0;
  const gateRequirements = requirements.filter(
    (requirement) => requirement.criticality === "GATE",
  );
  const blocked =
    matrix.eligibility.status === "BLOCK" ||
    gateRequirements.some((requirement) => requirement.judgement === "GAP");
  const needsReview =
    !blocked &&
    (matrix.eligibility.status === "RISK" ||
      gateRequirements.some(
        (requirement) =>
          requirement.judgement === "PARTIAL" ||
          requirement.judgement === "UNKNOWN",
      ));
  const gateCap = blocked ? 29 : needsReview ? 59 : null;
  const score = gateCap === null ? rawScore : Math.min(rawScore, gateCap);
  const criticalGaps = requirements
    .filter(
      (requirement) =>
        requirement.criticality === "GATE" &&
        requirement.judgement !== "MATCH",
    )
    .map((requirement) => ({
      id: requirement.id,
      requirement: requirement.requirement,
      judgement: requirement.judgement,
      ...(requirement.category ? { category: requirement.category } : {}),
    }));
  return {
    score,
    rawScore,
    verdict: verdictForScore(score),
    eligibility: matrix.eligibility.status,
    gateStatus: blocked ? "BLOCKED" : needsReview ? "REVIEW" : "CLEAR",
    gateCap,
    criticalGaps,
    typeScores,
  };
}
