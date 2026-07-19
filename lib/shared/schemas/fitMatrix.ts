import { z } from "zod";

/**
 * AI role-fit requirement matrix — the ONLY thing the model is trusted to
 * produce. Per spec §7.5 the model judges individual requirements; Joblit
 * aggregates the final score deterministically (see lib/server/ai/fitScoring).
 */

export const FIT_REQUIREMENT_TYPES = [
  "REQUIRED",
  "PREFERRED",
  "RESPONSIBILITY",
  "SENIORITY",
  "DOMAIN",
  "CREDENTIAL",
] as const;
export type FitRequirementType = (typeof FIT_REQUIREMENT_TYPES)[number];

export const FIT_JUDGEMENTS = ["MATCH", "PARTIAL", "GAP", "UNKNOWN"] as const;
export type FitJudgement = (typeof FIT_JUDGEMENTS)[number];

export const FIT_ELIGIBILITY = ["PASS", "RISK", "BLOCK"] as const;
export const FIT_CRITICALITIES = ["GATE", "CORE", "SUPPORTING"] as const;
export type FitCriticality = (typeof FIT_CRITICALITIES)[number];
export const FIT_REQUIREMENT_CATEGORIES = [
  "TECHNICAL",
  "EXPERIENCE",
  "RESPONSIBILITY",
  "DOMAIN",
  "CREDENTIAL",
  "ELIGIBILITY",
] as const;
export type FitRequirementCategory =
  (typeof FIT_REQUIREMENT_CATEGORIES)[number];

export const FitRequirementSchema = z
  .object({
    id: z.string().min(1).max(40),
    type: z.enum(FIT_REQUIREMENT_TYPES),
    requirement: z.string().min(1).max(300),
    judgement: z.enum(FIT_JUDGEMENTS),
    criticality: z.enum(FIT_CRITICALITIES).optional(),
    category: z.enum(FIT_REQUIREMENT_CATEGORIES).optional(),
    jdEvidence: z.string().min(1).max(400).optional(),
    candidateEvidence: z.string().min(1).max(400).optional(),
    // Backward-compatible field used by older Extension builds. New prompts
    // prefer jdEvidence/candidateEvidence because their meaning is explicit.
    evidence: z.string().max(400).optional(),
    note: z.string().max(300).optional(),
  })
  .strict();

export const FitMatrixSchema = z
  .object({
    requirements: z.array(FitRequirementSchema).min(1).max(30),
    eligibility: z
      .object({
        status: z.enum(FIT_ELIGIBILITY),
        reasons: z.array(z.string().min(1).max(300)).max(5),
      })
      .strict(),
  })
  .strict();
export type FitMatrix = z.infer<typeof FitMatrixSchema>;

export const FIT_VERDICTS = ["STRONG", "GOOD", "MODERATE", "WEAK", "POOR"] as const;
export type FitVerdict = (typeof FIT_VERDICTS)[number];
