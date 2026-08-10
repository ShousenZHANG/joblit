import type { ApplicationPublication } from "@/lib/shared/applicationPublication";
import type { AiContent } from "@/lib/shared/schemas/aiContent";
import type { TailorTarget } from "../[id]/tailor/tailorActions";

export type TailorReviewDraft = {
  applicationId: string;
  target: TailorTarget;
  initialPublication: ApplicationPublication;
  initialAiContent: AiContent;
  initialAiContentHash: string | null;
  resumePdfUrl: string | null;
  coverPdfUrl: string | null;
  /** Canonical download name from the server; null uses the shared builder. */
  pdfName?: string | null;
  source?: "manual_import" | "ai";
  job: {
    id: string | null;
    title: string;
    company: string | null;
    location: string | null;
  };
};

export type TailorReviewFinalized = {
  target: TailorTarget;
  resumePdfUrl?: string;
  resumePdfName?: string;
  coverPdfUrl?: string;
  coverPdfName?: string;
};
