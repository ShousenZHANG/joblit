import { z } from "zod";
import { applicationPublicationSchema } from "@/lib/shared/applicationPublication";
import { aiContentSchema } from "@/lib/shared/schemas/aiContent";

const reviewDocumentSchema = z
  .object({
    pdfUrl: z.string().nullable(),
    pdfName: z.string().min(1),
  })
  .strict();

/**
 * Complete, session-only bootstrap for the existing tailoring editor.
 *
 * Batch polling deliberately carries only Application identity and artifact
 * pointers. The larger AI Content snapshot crosses the browser seam only when
 * its owner explicitly opens Review & Edit.
 */
export const applicationReviewSnapshotSchema = z
  .object({
    applicationId: z.string().uuid(),
    publication: applicationPublicationSchema,
    aiContentHash: z.string().nullable(),
    aiContent: aiContentSchema,
    documents: z
      .object({
        resume: reviewDocumentSchema,
        cover: reviewDocumentSchema,
      })
      .strict(),
    job: z
      .object({
        id: z.string().uuid().nullable(),
        title: z.string(),
        company: z.string().nullable(),
        location: z.string().nullable(),
        market: z.string(),
      })
      .strict(),
  })
  .strict();

export type ApplicationReviewSnapshot = z.infer<
  typeof applicationReviewSnapshotSchema
>;
