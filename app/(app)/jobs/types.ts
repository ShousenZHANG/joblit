export type JobStatus = "NEW" | "APPLIED" | "REJECTED";

export type MatchTier = "strong" | "good" | "fair" | "weak";

export type MatchBreakdown = {
  tier: MatchTier;
  matchedSkills: string[];
  missingSkills: string[];
  breakdown: {
    skillsScore: number;
    titleScore: number;
    levelScore: number;
    experienceScore: number;
  };
};

export type JobItem = {
  id: string;
  jobUrl: string;
  title: string;
  company: string | null;
  location: string | null;
  jobType: string | null;
  jobLevel: string | null;
  status: JobStatus;
  resumePdfUrl?: string | null;
  resumePdfName?: string | null;
  coverPdfUrl?: string | null;
  createdAt: string;
  updatedAt: string;
  matchScore?: number | null;
  matchBreakdown?: MatchBreakdown | null;
};

export type JobsResponse = {
  items: JobItem[];
  nextCursor: string | null;
  totalCount?: number;
  facets?: {
    jobLevels?: string[];
  };
};

export type JobsQueryRollbackPatch = {
  queryHash: string;
  queryKey: readonly unknown[];
  previousItem: JobItem;
  previousIndex: number;
  previousTotalCount?: number;
};

export type CvSource = "ai" | "base" | "manual_import";
export type CoverSource = "ai" | "fallback" | "manual_import";

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
