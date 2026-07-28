import { z } from "zod";

/**
 * Public projection of one Application's independently publishable documents.
 *
 * `Application.status` remains available as a compatibility summary, but it is
 * no longer the source of truth for either document. A document is FINAL only
 * when its current content hash matches the hash attached to its published PDF.
 */

export const APPLICATION_DOCUMENT_TARGETS = ["resume", "cover"] as const;

export type ApplicationDocumentTarget =
  (typeof APPLICATION_DOCUMENT_TARGETS)[number];

export const applicationDocumentPublicationSchema = z
  .object({
    status: z.enum(["MISSING", "DRAFT", "FINAL"]),
    contentHash: z.string().nullable(),
    publishedHash: z.string().nullable(),
  })
  .superRefine((document, context) => {
    if (document.status === "MISSING" && document.contentHash !== null) {
      context.addIssue({
        code: "custom",
        message: "MISSING documents cannot have current content",
        path: ["contentHash"],
      });
    }
    if (document.status === "DRAFT" && document.contentHash === null) {
      context.addIssue({
        code: "custom",
        message: "DRAFT documents require current content",
        path: ["contentHash"],
      });
    }
    if (
      document.status === "FINAL" &&
      (!document.contentHash ||
        document.publishedHash !== document.contentHash)
    ) {
      context.addIssue({
        code: "custom",
        message: "FINAL documents require matching content and publication hashes",
        path: ["publishedHash"],
      });
    }
  });

export const applicationPublicationSchema = z
  .object({
    status: z.enum(["DRAFT", "FINAL"]),
    resume: applicationDocumentPublicationSchema,
    cover: applicationDocumentPublicationSchema,
  })
  .superRefine((publication, context) => {
    const present = [publication.resume, publication.cover].filter(
      (document) => document.status !== "MISSING",
    );
    const expectedStatus =
      present.length > 0 &&
      present.every((document) => document.status === "FINAL")
        ? "FINAL"
        : "DRAFT";
    if (publication.status !== expectedStatus) {
      context.addIssue({
        code: "custom",
        message: "Aggregate status does not match document publication state",
        path: ["status"],
      });
    }
  });

export type ApplicationDocumentPublicationStatus = z.infer<
  typeof applicationDocumentPublicationSchema
>["status"];

export type ApplicationDocumentPublication = z.infer<
  typeof applicationDocumentPublicationSchema
>;

export type ApplicationPublication = z.infer<
  typeof applicationPublicationSchema
>;
