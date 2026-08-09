import { z } from "zod";
import { JOB_STATUS_VALUES } from "@/lib/shared/jobStatus";
import {
  EMPTY_JOB_EXPERIENCE_ANALYSIS,
  JobExperienceAnalysisSchema,
} from "@/lib/shared/jobExperienceAnalysis";
import {
  LegacyJobExperienceAnalysisSchema,
  LegacyJobExperienceAnalysisV2Schema,
  upgradeJobExperienceAnalysisV1,
  upgradeJobExperienceAnalysisV2,
} from "@/lib/shared/jobExperienceAnalysisCompat";

/**
 * The `GET /api/jobs` and `GET /api/jobs/[id]` response contracts.
 *
 * The Application half of the Jobs workspace was schema-derived and validated
 * at the seam; the Job half was a hand-written type in `app/(app)/jobs/types.ts`
 * with no runtime check, so `useJobPagination` filled gaps with `??` defaults
 * and a malformed row reached the list as a half-rendered card.
 *
 * Objects are deliberately not `.strict()`: Zod strips unknown keys, so adding
 * a field server-side stays backward compatible with a client that has not
 * shipped yet.
 */

export const jobStatusValueSchema = z.enum(JOB_STATUS_VALUES);

export const jobListItemSchema = z.object({
  id: z.string(),
  jobUrl: z.string(),
  title: z.string(),
  company: z.string().nullable(),
  location: z.string().nullable(),
  jobType: z.string().nullable(),
  jobLevel: z.string().nullable(),
  salary: z.string().nullable().optional(),
  workArrangement: z.string().nullable().optional(),
  listingDate: z.string().nullable().optional(),
  status: jobStatusValueSchema,
  market: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
  postingRisk: z.number().nullable().optional(),
  postingRiskFlags: z.array(z.string()).nullable().optional(),
  resumePdfUrl: z.string().nullable().optional(),
  resumePdfName: z.string().nullable().optional(),
  coverPdfUrl: z.string().nullable().optional(),
  livenessStatus: z.enum(["ACTIVE", "EXPIRED", "UNCERTAIN"]).optional(),
  livenessReason: z.string().nullable().optional(),
  possibleDuplicate: z.boolean().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const jobsListResponseSchema = z.object({
  items: z.array(jobListItemSchema),
  nextCursor: z.string().nullable(),
  totalCount: z.number().optional(),
  facets: z.object({ jobLevels: z.array(z.string()).optional() }).optional(),
});

const jobDetailWireResponseSchema = z
  .object({
    id: z.string(),
    description: z.string().nullable(),
    // The three slots support a migration-before-build rolling deployment.
    // New clients prefer v3, while old revisions continue to consume v1/v2.
    experienceAnalysis: z
      .union([
        LegacyJobExperienceAnalysisSchema,
        LegacyJobExperienceAnalysisV2Schema,
        JobExperienceAnalysisSchema,
      ])
      .optional(),
    experienceAnalysisV2: z
      .union([LegacyJobExperienceAnalysisV2Schema, JobExperienceAnalysisSchema])
      .optional(),
    experienceAnalysisV3: JobExperienceAnalysisSchema.optional(),
    /** Cache version for score/matrix coherence with the list row. */
    updatedAt: z.string(),
  })
  .transform(
    ({
      experienceAnalysis,
      experienceAnalysisV2,
      experienceAnalysisV3,
      ...detail
    }) => ({
      ...detail,
      experienceAnalysis:
        experienceAnalysisV3 ??
        (experienceAnalysisV2?.schemaVersion === 3
          ? experienceAnalysisV2
          : experienceAnalysisV2
            ? upgradeJobExperienceAnalysisV2(experienceAnalysisV2)
            : experienceAnalysis?.schemaVersion === 3
              ? experienceAnalysis
              : experienceAnalysis?.schemaVersion === 2
                ? upgradeJobExperienceAnalysisV2(experienceAnalysis)
                : experienceAnalysis
                  ? upgradeJobExperienceAnalysisV1(experienceAnalysis)
                  : EMPTY_JOB_EXPERIENCE_ANALYSIS),
    }),
  );

export const jobDetailResponseSchema = jobDetailWireResponseSchema.superRefine(
  (detail, context) => {
    const requirements = detail.experienceAnalysis.requirements;
    for (const [index, requirement] of requirements.entries()) {
      const evidence = requirement.evidence;
      const evidenceMatches =
        detail.description?.slice(evidence.start, evidence.end) ===
        evidence.text;
      const yearsMatch =
        detail.description?.slice(evidence.yearsStart, evidence.yearsEnd) ===
        requirement.years.text;
      if (!evidenceMatches || !yearsMatch) {
        context.addIssue({
          code: "custom",
          path: ["experienceAnalysis", "requirements", index, "evidence"],
          message: "experience evidence must match the job description source",
        });
      }
    }
  },
);

export type JobListItem = z.infer<typeof jobListItemSchema>;
export type JobsListResponse = z.infer<typeof jobsListResponseSchema>;
export type JobDetailResponse = z.infer<typeof jobDetailResponseSchema>;
