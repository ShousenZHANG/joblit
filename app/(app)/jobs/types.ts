import type {
  JobDetailResponse,
  JobListItem,
  JobsListResponse,
} from "@/lib/shared/schemas/jobsList";
import type { JobStatusValue } from "@/lib/shared/jobStatus";
import type {
  CoverGenerationOutput,
  ResumeGenerationOutput,
} from "@/lib/shared/schemas/applicationGenerationOutput";

export type JobStatus = JobStatusValue;

export const JOB_STATUS_LABEL_KEYS: Record<
  JobStatus,
  | "statusNew"
  | "statusApplied"
  | "statusInterview"
  | "statusOffer"
  | "statusRejected"
  | "statusWithdrawn"
  | "statusAccepted"
> = {
  NEW: "statusNew",
  APPLIED: "statusApplied",
  INTERVIEW: "statusInterview",
  OFFER: "statusOffer",
  REJECTED: "statusRejected",
  WITHDRAWN: "statusWithdrawn",
  ACCEPTED: "statusAccepted",
};

// Derived from the schema that validates these at the seam, so the type and
// the runtime check cannot disagree. They used to be written out twice.
export type JobItem = JobListItem;
export type JobsResponse = JobsListResponse;
export type { JobDetailResponse };

export type CvSource = "ai" | "base" | "manual_import" | "local_ai";
export type CoverSource = "ai" | "fallback" | "manual_import" | "local_ai";

// Derived from the schemas the server validates against, so a client that
// believes a paste is importable cannot disagree with the import boundary.
export type ResumeImportOutput = ResumeGenerationOutput;
export type CoverImportOutput = CoverGenerationOutput;

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
