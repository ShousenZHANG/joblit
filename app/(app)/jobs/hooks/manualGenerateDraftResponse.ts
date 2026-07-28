import { z } from "zod";
import { applicationPublicationSchema } from "@/lib/shared/applicationPublication";
import { aiContentSchema } from "@/lib/shared/schemas/aiContent";

/**
 * Complete client boundary for `manual-generate?finalize=false`.
 *
 * The editor must never receive partially trusted AI Content or lose its CAS
 * baseline because a proxy/server regression returned a malformed 2xx body.
 */
export const manualGenerateDraftResponseSchema = z
  .object({
    applicationId: z.string().min(1),
    status: z.enum(["DRAFT", "FINAL"]),
    publication: applicationPublicationSchema,
    aiContentHash: z.string().min(1),
    aiContent: aiContentSchema,
    pdfName: z
      .string()
      .nullable()
      .optional()
      .transform((value) => value ?? null),
    job: z.object({
      id: z.string().min(1),
      title: z.string(),
      company: z.string().nullable(),
      location: z.string().nullable(),
    }),
  })
  .refine((response) => response.status === response.publication.status, {
    message: "Draft status does not match publication state",
    path: ["status"],
  });

export type ManualGenerateDraftResponse = z.infer<
  typeof manualGenerateDraftResponseSchema
>;
