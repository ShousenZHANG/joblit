import type { FitMatrix } from "@/lib/shared/schemas/fitMatrix";

export type JobStatus = "NEW" | "APPLIED" | "REJECTED";

export type JobItem = {
  id: string;
  jobUrl: string;
  title: string;
  company: string | null;
  location: string | null;
  jobType: string | null;
  jobLevel: string | null;
  salary?: string | null;
  workArrangement?: string | null;
  listingDate?: string | null;
  status: JobStatus;
  resumePdfUrl?: string | null;
  resumePdfName?: string | null;
  coverPdfUrl?: string | null;
  fitScore?: number | null;
  fitVerdict?: string | null;
  fitEligibility?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type JobsResponse = {
  items: JobItem[];
  nextCursor: string | null;
  totalCount?: number;
  facets?: {
    jobLevels?: string[];
  };
};

export type JobDetailResponse = {
  id: string;
  description: string | null;
  fitMatrix: FitMatrix | null;
  /** Cache version for score/matrix coherence with the list row. */
  updatedAt: string;
};

export type CvSource = "ai" | "base" | "manual_import" | "local_ai";
export type CoverSource = "ai" | "fallback" | "manual_import" | "local_ai";

export type ResumeImportOutput = {
  cvSummary: string;
};

export type CoverImportOutput = {
  cover: {
    subject?: string;
    date?: string;
    salutation?: string;
    paragraphOne: string;
    paragraphTwo: string;
    paragraphThree: string;
    closing?: string;
    signatureName?: string;
  };
};

export type ExternalPromptMeta = {
  ruleSetId: string;
  resumeSnapshotUpdatedAt: string;
  promptTemplateVersion?: string;
  schemaVersion?: string;
  skillPackVersion?: string;
  promptHash?: string;
};

export function getErrorMessage(err: unknown, fallback = "Failed") {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return fallback;
}
