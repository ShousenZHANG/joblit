import { z } from "zod";

/**
 * Browser-safe semantic source for every current AI generation output.
 *
 * Server prompt/schema generation, provider parsing, and the manual UI all
 * consume these exact schemas. Compatibility dialects stay outside this file
 * so they cannot silently become generated contracts.
 */
export const ResumeGenerationOutputSchema = z
  .object({
    cvSummary: z.string().trim().min(1).max(2000),
    latestExperience: z
      .object({
        addedBullets: z
          .array(z.string().trim().min(1).max(320))
          .min(0)
          .max(3),
      })
      .strict(),
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

export type ResumeGenerationOutput = z.infer<
  typeof ResumeGenerationOutputSchema
>;
export type CoverGenerationOutput = z.infer<
  typeof CoverGenerationOutputSchema
>;
