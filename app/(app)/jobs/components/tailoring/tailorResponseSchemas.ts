import { z } from "zod";
import { applicationPublicationSchema } from "@/lib/shared/applicationPublication";
import { aiContentSchema } from "@/lib/shared/schemas/aiContent";

const optionalPdfValueSchema = z
  .string()
  .nullable()
  .optional()
  .transform((value) => value ?? undefined);

export const tailorDraftCommitSchema = z.object({
  aiContentHash: z.string(),
  publication: applicationPublicationSchema,
});

export const finalizeResultSchema = z
  .object({
    status: z.enum(["DRAFT", "FINAL"]),
    publication: applicationPublicationSchema,
    aiContentHash: z.string(),
    resumePdfUrl: optionalPdfValueSchema,
    resumePdfName: optionalPdfValueSchema,
    coverPdfUrl: optionalPdfValueSchema,
    coverPdfName: optionalPdfValueSchema,
  })
  .refine((result) => result.status === result.publication.status, {
    message: "Finalize status does not match publication state",
    path: ["status"],
  });

export const discardResultSchema = z.object({
  aiContent: aiContentSchema,
  aiContentHash: z.string(),
  publication: applicationPublicationSchema,
});

export type FinalizeResponse = z.infer<typeof finalizeResultSchema>;
export type DiscardResponse = z.infer<typeof discardResultSchema>;
