import type { PromptMeta } from "@/lib/server/ai/promptContract";
import type { ApplicationPromptPayload } from "@/lib/server/applications/applicationPrompt";
import {
  bindTailoringRunPrompt,
  failTailoringRun,
  issueTailoringRun,
  startTailoringRun,
} from "./tailoringRunService";
import { TailoringRunError } from "./tailoringRunProtocol";
import type {
  TailoringRunDelivery,
  TailoringRunSource,
  TailoringRunTarget,
} from "./tailoringRunProtocol";
import type { TailoringBatchBinding } from "./tailoringRunTypes";

type PromptRunInput = {
  userId: string;
  jobId: string;
  target: "resume" | "cover";
  source: TailoringRunSource;
  delivery: TailoringRunDelivery;
  issueKey: string;
  payload: ApplicationPromptPayload;
  batch?: TailoringBatchBinding | null;
};

function protocolTarget(target: PromptRunInput["target"]): TailoringRunTarget {
  return target === "resume" ? "RESUME" : "COVER";
}

function promptReceipt(meta: PromptMeta) {
  return {
    promptHash: meta.promptHash,
    promptMetaHash: meta.promptHash,
    ruleSetId: meta.ruleSetId,
    promptTemplateVersion: meta.promptTemplateVersion,
    schemaVersion: meta.schemaVersion,
    skillPackVersion: meta.skillPackVersion,
  };
}

/**
 * Bind a freshly built prompt to a durable TailoringRun without storing the
 * prompt bytes. Batch runs require both targets; interactive runs own only the
 * target whose prompt was issued.
 */
export async function issuePromptTailoringRun(input: PromptRunInput) {
  const binding = input.payload.snapshotBinding;
  if (!binding) {
    // The prompt was built without the snapshot hashes a run is fenced
    // against. Deterministic — a retry issues the same prompt — so it must not
    // reach an agent client as a retryable 500.
    throw new TailoringRunError(
      "PROMPT_NOT_BOUND",
      "This prompt is missing its snapshot binding. Generate this job again.",
    );
  }
  const target = protocolTarget(input.target);
  const issue = await issueTailoringRun({
    userId: input.userId,
    issueKey: input.issueKey,
    jobId: input.jobId,
    resumeProfileId: binding.resumeProfileId,
    source: input.source,
    delivery: input.delivery,
    requiredTargets: input.batch ? ["RESUME", "COVER"] : [target],
    publicationRequiredTargets:
      input.batch && input.delivery === "DRAFT"
        ? ["RESUME", "COVER"]
        : [],
    resumeSnapshotHash: binding.resumeSnapshotHash,
    jobSnapshotHash: binding.jobSnapshotHash,
    batch: input.batch,
    // Target receipts bind independently after start. Keeping issue identity
    // target-neutral lets Resume and Cover share one batch run.
    promptReceipts: {},
  });

  const attemptId =
    input.batch?.executionAttemptId ?? issue.run.handle?.attemptId;
  const started = await startTailoringRun({
    userId: input.userId,
    runId: issue.run.id,
    ...(attemptId ? { attemptId } : {}),
    ...(input.batch
      ? { batchExecutionAttemptId: input.batch.executionAttemptId }
      : {}),
  });

  try {
    await bindTailoringRunPrompt({
      userId: input.userId,
      runId: issue.run.id,
      target,
      receipt: promptReceipt(input.payload.promptMeta),
      ...(input.batch
        ? { batchExecutionAttemptId: input.batch.executionAttemptId }
        : {}),
    });
  } catch (error) {
    // A stable interactive issue key can outlive a prompt-rule deployment.
    // Terminate that now-unusable run before the client rotates its issue key,
    // otherwise it remains RUNNING forever and the next prompt cannot bind.
    if (
      !input.batch &&
      error instanceof TailoringRunError &&
      error.code === "PROMPT_CONFLICT"
    ) {
      await failTailoringRun({
        userId: input.userId,
        handle: started.handle,
        errorCode: "PROMPT_SUPERSEDED",
        errorMessage: "Prompt contract changed before acceptance",
      }).catch(() => undefined);
    }
    throw error;
  }

  return started.handle;
}
