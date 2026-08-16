import { z } from "zod";

/**
 * Browser-safe semantic source for every current AI generation output.
 *
 * Server prompt/schema generation, provider parsing, and the manual UI all
 * consume these exact schemas. Compatibility dialects stay outside this file
 * so they cannot silently become generated contracts.
 */

/**
 * Tailoring changes two things on a CV: the summary, and which of the
 * candidate's own skills appear and in what order. Both are bounded here.
 *
 * The summary is the only free text the model may write onto a resume, so it
 * carries a hard length window rather than a generous ceiling. 350 characters
 * is roughly 55 words: enough to name the target title, the specialisation and
 * a working-rights clause, and short enough that a model cannot pad it into the
 * paragraph that recruiters skip. Its content is checked separately — see
 * `lib/server/ai/summaryLint.ts`, which enforces the target job title and
 * refuses numbers and skills the master profile cannot support.
 */
const CV_SUMMARY_MIN = 120;
const CV_SUMMARY_MAX = 350;

/** Mirrors `ResumeProfileSchema.skills`: at most 12 groups of at most 30. */
const MAX_SKILL_GROUPS = 12;
const MAX_SKILL_ITEMS = 30;

/**
 * A tailored skills section, expressed only as references into the candidate's
 * own skill bank: `group` indexes `ResumeProfile.skills`, and each entry of
 * `items` indexes that group's `items`. Array order is render order.
 *
 * Referencing rather than writing is the whole point. AI-authored skills were
 * retired because the model proposed skills the candidate had no evidence for
 * (see CONTEXT.md → AI Content), and a model that can only return numbers
 * cannot invent one. New skills enter the resume through the Resume Studio,
 * where the candidate types them, and never through a generation.
 *
 * Bounds here are structural only. Whether an index actually exists in the
 * candidate's profile depends on the profile, so it is checked server-side at
 * the import boundary.
 */
const SkillSelectionGroupSchema = z
  .object({
    group: z.number().int().min(0).max(MAX_SKILL_GROUPS - 1),
    items: z
      .array(z.number().int().min(0).max(MAX_SKILL_ITEMS - 1))
      .min(1)
      .max(MAX_SKILL_ITEMS),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.items).size !== value.items.length) {
      ctx.addIssue({
        code: "custom",
        path: ["items"],
        message: "Skill items must not repeat within a group.",
      });
    }
  });

export const SkillsSelectionSchema = z
  .array(SkillSelectionGroupSchema)
  .min(1)
  .max(MAX_SKILL_GROUPS)
  .superRefine((groups, ctx) => {
    const seen = new Set(groups.map((entry) => entry.group));
    if (seen.size !== groups.length) {
      ctx.addIssue({
        code: "custom",
        message: "Each skill group may be selected at most once.",
      });
    }
  });

export const ResumeGenerationOutputSchema = z
  .object({
    cvSummary: z.string().trim().min(CV_SUMMARY_MIN).max(CV_SUMMARY_MAX),
    skillsSelection: SkillsSelectionSchema,
  })
  .strict();

export const CoverGenerationOutputSchema = z
  .object({
    cover: z
      .object({
        paragraphOne: z.string().trim().min(1).max(2000),
        paragraphTwo: z.string().trim().min(1).max(2000),
        paragraphThree: z.string().trim().min(1).max(2000),
      })
      .strict(),
  })
  .strict();

export const CV_SUMMARY_LENGTH = {
  min: CV_SUMMARY_MIN,
  max: CV_SUMMARY_MAX,
} as const;

export type SkillsSelection = z.infer<typeof SkillsSelectionSchema>;
export type ResumeGenerationOutput = z.infer<
  typeof ResumeGenerationOutputSchema
>;
export type CoverGenerationOutput = z.infer<
  typeof CoverGenerationOutputSchema
>;
