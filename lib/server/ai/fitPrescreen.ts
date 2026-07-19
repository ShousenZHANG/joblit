import { analyzeJobTechnicalRequirements } from "@/lib/shared/jdTechnicalAnalysis";
import {
  expandSkillSet,
  extractSkills,
} from "@/lib/shared/skillsGazetteer";
import { verdictForScore, type FitScoreResult } from "./fitScoring";

/**
 * Zero-cost deterministic prescreen: gazetteer skill overlap between the JD
 * and the resume snapshot text. Jobs far below the bar are marked POOR without
 * spending a local AI run; everything else goes to the model for the real
 * requirement matrix. Local Hermes runs are serial and 10-30s each, so cutting
 * the obvious misses first keeps a 100-job scan tractable.
 */

export const PRESCREEN_POOR_THRESHOLD = 25;

export type PrescreenResult =
  | { decision: "score_with_ai" }
  | {
      decision: "poor";
      result: Pick<FitScoreResult, "score" | "verdict"> & {
        matchedSkills: string[];
        missingSkills: string[];
        criticalSkills: string[];
      };
    };

export function prescreenJobFit(input: {
  jobDescription: string | null | undefined;
  resumeText: string;
}): PrescreenResult {
  const description = input.jobDescription?.trim() ?? "";
  if (!description) return { decision: "score_with_ai" };

  const requirements = analyzeJobTechnicalRequirements(description).filter(
    (requirement) =>
      requirement.priority === "REQUIRED" ||
      requirement.priority === "CORE",
  );
  // A short or weakly structured JD is not enough evidence for auto-rejection.
  if (requirements.length < 3) return { decision: "score_with_ai" };

  const resumeSkills = expandSkillSet(extractSkills(input.resumeText));
  let matchedWeight = 0;
  let totalWeight = 0;
  const matchedSkills: string[] = [];
  const missingSkills: string[] = [];
  for (const requirement of requirements) {
    const weight = requirement.isGate
      ? 3
      : requirement.priority === "REQUIRED"
        ? 2
        : 1;
    totalWeight += weight;
    if (resumeSkills.has(requirement.skill)) {
      matchedWeight += weight;
      matchedSkills.push(requirement.skill);
    } else {
      missingSkills.push(requirement.skill);
    }
  }
  const score =
    totalWeight > 0 ? Math.round((matchedWeight / totalWeight) * 100) : 0;
  if (score >= PRESCREEN_POOR_THRESHOLD) return { decision: "score_with_ai" };
  return {
    decision: "poor",
    result: {
      score,
      verdict: verdictForScore(score),
      matchedSkills,
      missingSkills,
      criticalSkills: requirements
        .filter((requirement) => requirement.isGate)
        .map((requirement) => requirement.skill),
    },
  };
}
