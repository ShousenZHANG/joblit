import type { TailoringRunHandle } from "@/lib/shared/tailoringRunContract";
import type {
  TailoringRunDelivery,
  TailoringRunSource,
  TailoringRunStatus,
  TailoringRunTarget,
} from "./tailoringRunProtocol";

export type TailoringPromptReceipt = {
  promptHash: string;
  promptMetaHash?: string;
  ruleSetId?: string;
  promptTemplateVersion?: string;
  schemaVersion?: string;
  skillPackVersion?: string;
};

export type TailoringPromptReceipts = Partial<
  Record<TailoringRunTarget, TailoringPromptReceipt>
>;

export type TailoringBatchBinding = {
  taskId: string;
  batchId: string;
  executionAttemptId: string;
};

export type IssueTailoringRunInput = {
  userId: string;
  issueKey: string;
  jobId: string;
  resumeProfileId?: string | null;
  source: TailoringRunSource;
  delivery: TailoringRunDelivery;
  requiredTargets: readonly TailoringRunTarget[];
  publicationRequiredTargets?: readonly TailoringRunTarget[];
  resumeSnapshotHash: string;
  jobSnapshotHash: string;
  batch?: TailoringBatchBinding | null;
  promptReceipts?: TailoringPromptReceipts;
};

export type StartTailoringRunInput = {
  userId: string;
  runId: string;
  attemptId?: string;
  batchExecutionAttemptId?: string;
};

export type BindTailoringRunPromptInput = {
  userId: string;
  runId: string;
  target: TailoringRunTarget;
  receipt: TailoringPromptReceipt;
  batchExecutionAttemptId?: string;
};

export type FailTailoringRunInput = {
  userId: string;
  handle: TailoringRunHandle;
  errorCode: string;
  errorMessage?: string | null;
  batchExecutionAttemptId?: string;
};

export type CancelTailoringRunInput = {
  userId: string;
  handle: TailoringRunHandle;
};

export type TailoringRunSnapshot = {
  id: string;
  status: TailoringRunStatus;
  source: TailoringRunSource;
  delivery: TailoringRunDelivery;
  requiredTargetMask: number;
  acceptedTargetMask: number;
  publicationRequiredTargetMask: number;
  publishedTargetMask: number;
  applicationId: string | null;
  applicationBatchTaskId: string | null;
  handle: TailoringRunHandle | null;
  attempt: number;
  leaseExpiresAt: Date | null;
  errorCode: string | null;
  errorMessage: string | null;
  terminalAt: Date | null;
};

export type TailoringRunMutationResult = {
  disposition: "APPLIED" | "REPLAYED";
  run: TailoringRunSnapshot;
};

export type StartTailoringRunResult = TailoringRunMutationResult & {
  handle: TailoringRunHandle;
};

export type TailoringAcceptanceRequest = {
  handle: TailoringRunHandle;
  source: TailoringRunSource;
  delivery: TailoringRunDelivery;
  target: TailoringRunTarget;
  requestHash: string;
  promptHash: string;
  resumeSnapshotHash: string;
  jobSnapshotHash: string;
  batchExecutionAttemptId?: string;
};

export type TailoringAcceptanceReceipt = {
  runId: string;
  target: TailoringRunTarget;
  executionAttemptId: string;
  requestHash: string;
  applicationId: string | null;
  aiContentHash: string;
  documentContentHash: string | null;
  delivery: TailoringRunDelivery;
};

/**
 * Minimal public command envelope needed to discover an already-durable
 * acceptance. It deliberately omits mutable attempt/snapshot state: an exact
 * response-loss retry is authorized by the immutable receipt, not by whether
 * the original attempt is still current.
 */
export type TailoringAcceptanceReplayProbe = {
  handle: TailoringRunHandle;
  source: TailoringRunSource;
  delivery: TailoringRunDelivery;
  target: TailoringRunTarget;
  requestHash: string;
  promptHash: string;
};

export type TailoringAcceptanceReplayApplication = {
  id: string;
  status: "DRAFT" | "FINAL";
  aiContent: unknown;
  aiContentHash: string | null;
  resumePdfUrl: string | null;
  resumePdfName: string | null;
  coverPdfUrl: string | null;
  resumeContentHash: string | null;
  coverContentHash: string | null;
  resumePublishedHash: string | null;
  coverPublishedHash: string | null;
  job: {
    id: string;
    title: string;
    company: string | null;
    location: string | null;
    market: string;
  };
  resumeProfile: {
    summary: string | null;
    basics: unknown;
    links: unknown;
    skills: unknown;
    experiences: unknown;
    projects: unknown;
    education: unknown;
  } | null;
};

export type TailoringAcceptanceReplay = {
  receipt: TailoringAcceptanceReceipt;
  application: TailoringAcceptanceReplayApplication;
};

export type PreparedTailoringAcceptance = {
  userId: string;
  pending: TailoringAcceptanceRequest[];
  replayed: TailoringAcceptanceReceipt[];
  runs: PreparedTailoringRun[];
};

export type PreparedTailoringRun = {
  id: string;
  source: TailoringRunSource;
  delivery: TailoringRunDelivery;
  requiredTargetMask: number;
  acceptedTargetMask: number;
  publicationRequiredTargetMask: number;
  publishedTargetMask: number;
  executionAttemptId: string;
  applicationBatchTaskId: string | null;
  batchId: string | null;
  batchExecutionAttemptId: string | null;
  batchTask: {
    id: string;
    batchId: string;
    userId: string;
    jobId: string;
    status: string;
    executionAttemptId: string | null;
    tailoringProtocolVersion: number;
    completionAttemptId: string | null;
  } | null;
};

export type CompleteTailoringAcceptanceInput = {
  prepared: PreparedTailoringAcceptance;
  applicationId: string;
  aiContentHash: string;
  documentContentHashes: Partial<Record<TailoringRunTarget, string>>;
};

export type CompletedTailoringAcceptance = {
  receipts: TailoringAcceptanceReceipt[];
  completedRunIds: string[];
};
