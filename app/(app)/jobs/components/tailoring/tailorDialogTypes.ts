import type { ApplicationPublication } from "@/lib/shared/applicationPublication";
import type { AiContent } from "@/lib/shared/schemas/aiContent";
import type { MasterSkillGroup } from "@/lib/shared/tailorReviewSnapshot";
import type { TailorTarget } from "./tailorActions";

/**
 * Everything the dialog needs to edit one Application, loaded once when the
 * user opens it.
 *
 * `masterSkills` is the candidate's own skill bank. The stored selection is
 * nothing but index references into it, so without the bank the review panel
 * has numbers and no names to render.
 */
export type TailorReviewDraft = {
  applicationId: string;
  initialPublication: ApplicationPublication;
  initialAiContent: AiContent;
  initialAiContentHash: string | null;
  masterSkills: MasterSkillGroup[];
  resumePdfUrl: string | null;
  coverPdfUrl: string | null;
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
