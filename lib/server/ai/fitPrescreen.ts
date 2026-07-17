import { extractSkills } from "@/lib/shared/skillsGazetteer";
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
  | { decision: "poor"; result: Pick<FitScoreResult, "score" | "verdict"> };

export function prescreenJobFit(input: {
  jobDescription: string | null | undefined;
  resumeText: string;
}): PrescreenResult {
  const description = input.jobDescription?.trim() ?? "";
  if (!description) return { decision: "score_with_ai" };

  const jdSkills = extractSkills(description);
  // A JD the gazetteer cannot read is not evidence of a mismatch.
  if (jdSkills.size < 3) return { decision: "score_with_ai" };

  const resumeSkills = extractSkills(input.resumeText);
  let overlap = 0;
  for (const skill of jdSkills) {
    if (resumeSkills.has(skill)) overlap += 1;
  }
  const score = Math.round((overlap / jdSkills.size) * 100);
  if (score >= PRESCREEN_POOR_THRESHOLD) return { decision: "score_with_ai" };
  return { decision: "poor", result: { score, verdict: verdictForScore(score) } };
}
