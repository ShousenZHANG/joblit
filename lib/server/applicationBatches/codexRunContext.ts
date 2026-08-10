import { createHash } from "node:crypto";
import type { ApplicationBatchStatus, ApplicationBatchTaskStatus, JobStatus } from "@/lib/generated/prisma";
import {
  PROMPT_SCHEMA_VERSION,
  PROMPT_TEMPLATE_VERSION,
} from "@/lib/server/ai/promptContract";
import { getActivePromptSkillRulesForUser } from "@/lib/server/promptRuleTemplates";
import { prisma } from "@/lib/server/prisma";
import {
  BatchRunnerError,
  claimNextBatchTask,
  completeBatchTask,
  reclaimStaleBatchTasks,
  type BatchProgress,
} from "./runner";

const TERMINAL_BATCH_STATUSES = new Set<ApplicationBatchStatus>([
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
]);

export type BatchRunStopReason = "LIMIT_REACHED" | "BATCH_COMPLETE" | "BATCH_TERMINAL";

type BatchRunTask = {
  taskId: string;
  attemptId: string;
  issueKey: string;
  protocolVersion: 1 | 2;
  delivery: "FINAL" | "DRAFT";
  acceptedTargets: Array<"RESUME" | "COVER">;
  remainingTargets: Array<"RESUME" | "COVER">;
  publishedTargets: Array<"RESUME" | "COVER">;
  remainingPublicationTargets: Array<"RESUME" | "COVER">;
  applicationId: string | null;
  applicationAiContentHash: string | null;
  tailoringRun: { id: string; attemptId: string } | null;
  jobId: string;
  job: {
    id: string;
    title: string;
    company: string | null;
    jobUrl: string;
    status: JobStatus;
    description: string | null;
    updatedAt: string;
  };
};

type BatchRunContext = {
  generationContract: {
    promptTemplateVersion: string;
    schemaVersion: string;
    promptReceiptEndpoint: "/api/applications/prompt";
  };
  rules: {
    locale: string;
    cvRules: string[];
    coverRules: string[];
    hardConstraints: string[];
  };
  resumeSnapshotHash: string;
};

type BatchTaskCompletionInput = {
  taskId: string;
  attemptId: string;
  status: Extract<ApplicationBatchTaskStatus, "FAILED" | "SKIPPED">;
  error?: string | null;
};

type BatchTaskCompletionResult = BatchTaskCompletionInput & {
  accepted: boolean;
  error?: string;
};

export function buildResumeSnapshotHash(profile: unknown) {
  const record = profile as Record<string, unknown>;
  const payload = {
    summary: record.summary ?? null,
    basics: record.basics ?? null,
    links: record.links ?? null,
    skills: record.skills ?? null,
    experiences: record.experiences ?? null,
    projects: record.projects ?? null,
    education: record.education ?? null,
    updatedAt:
      record.updatedAt instanceof Date ? record.updatedAt.toISOString() : String(record.updatedAt ?? ""),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export async function buildBatchRunContext(input: {
  userId: string;
  profile: { updatedAt?: unknown };
}): Promise<BatchRunContext> {
  const rules = await getActivePromptSkillRulesForUser(input.userId);

  return {
    generationContract: {
      promptTemplateVersion: PROMPT_TEMPLATE_VERSION,
      schemaVersion: PROMPT_SCHEMA_VERSION,
      promptReceiptEndpoint: "/api/applications/prompt",
    },
    rules: {
      locale: rules.locale,
      cvRules: rules.cvRules,
      coverRules: rules.coverRules,
      hardConstraints: rules.hardConstraints,
    },
    resumeSnapshotHash: buildResumeSnapshotHash(input.profile),
  };
}

export async function completeBatchRunTasks(input: {
  userId: string;
  batchId: string;
  completedTasks: BatchTaskCompletionInput[];
}): Promise<BatchTaskCompletionResult[]> {
  const completionResults: BatchTaskCompletionResult[] = [];
  const completionMap = new Map<string, BatchTaskCompletionInput>();

  for (const item of input.completedTasks) {
    if (!completionMap.has(item.taskId)) {
      completionMap.set(item.taskId, item);
    }
  }

  for (const completion of completionMap.values()) {
    try {
      await completeBatchTask({
        userId: input.userId,
        batchId: input.batchId,
        taskId: completion.taskId,
        attemptId: completion.attemptId,
        status: completion.status,
        error: completion.error,
      });
      completionResults.push({
        taskId: completion.taskId,
        attemptId: completion.attemptId,
        status: completion.status,
        accepted: true,
      });
    } catch (error) {
      if (error instanceof BatchRunnerError) {
        completionResults.push({
          taskId: completion.taskId,
          attemptId: completion.attemptId,
          status: completion.status,
          accepted: false,
          error: error.code,
        });
        continue;
      }
      throw error;
    }
  }

  return completionResults;
}

export async function claimBatchRunTasks(input: {
  userId: string;
  batchId: string;
  batchStatus: ApplicationBatchStatus;
  maxSteps: number;
  supportedProtocolVersions?: Array<1 | 2>;
}): Promise<
  | {
      kind: "ok";
      tasks: BatchRunTask[];
      stopReason: BatchRunStopReason;
      terminalStatus: ApplicationBatchStatus | null;
      doneStatus: ApplicationBatchStatus | null;
    }
  | { kind: "not_found" }
> {
  const tasks: BatchRunTask[] = [];
  let stopReason: BatchRunStopReason = "LIMIT_REACHED";
  let terminalStatus: ApplicationBatchStatus | null = null;
  let doneStatus: ApplicationBatchStatus | null = null;

  if (TERMINAL_BATCH_STATUSES.has(input.batchStatus)) {
    return {
      kind: "ok",
      tasks,
      stopReason: "BATCH_TERMINAL",
      terminalStatus: input.batchStatus,
      doneStatus,
    };
  }

  // Once per run, not once per claim: the reclaim scans the whole batch, so
  // repeating it inside the loop issues maxSteps full-batch writes that only
  // the first can act on.
  await reclaimStaleBatchTasks({ userId: input.userId, batchId: input.batchId });

  for (let i = 0; i < input.maxSteps; i += 1) {
    const claimed = await claimNextBatchTask({
      userId: input.userId,
      batchId: input.batchId,
      skipStaleReclaim: true,
      supportedProtocolVersions: input.supportedProtocolVersions ?? [1],
    });

    if (claimed.kind === "not_found") {
      return { kind: "not_found" };
    }
    if (claimed.kind === "terminal") {
      terminalStatus = claimed.batchStatus;
      stopReason = "BATCH_TERMINAL";
      break;
    }
    if (claimed.kind === "done") {
      doneStatus = claimed.batchStatus;
      stopReason = "BATCH_COMPLETE";
      break;
    }

    const job = await prisma.job.findFirst({
      where: {
        id: claimed.task.jobId,
        userId: input.userId,
      },
      select: {
        id: true,
        title: true,
        company: true,
        jobUrl: true,
        status: true,
        description: true,
        updatedAt: true,
      },
    });

    if (job) {
      tasks.push({
        taskId: claimed.task.id,
        attemptId: claimed.task.attemptId,
        issueKey: claimed.task.issueKey,
        protocolVersion: claimed.task.protocolVersion,
        delivery: claimed.task.delivery,
        acceptedTargets: claimed.task.acceptedTargets,
        remainingTargets: claimed.task.remainingTargets,
        publishedTargets: claimed.task.publishedTargets,
        remainingPublicationTargets: claimed.task.remainingPublicationTargets,
        applicationId: claimed.task.applicationId,
        applicationAiContentHash: claimed.task.applicationAiContentHash,
        tailoringRun: claimed.task.tailoringRun,
        jobId: claimed.task.jobId,
        job: {
          id: job.id,
          title: job.title,
          company: job.company,
          jobUrl: job.jobUrl,
          status: job.status,
          description: job.description,
          updatedAt: job.updatedAt.toISOString(),
        },
      });
    }
  }

  return { kind: "ok", tasks, stopReason, terminalStatus, doneStatus };
}

export function deriveBatchStatusFromRun(input: {
  initialBatchStatus: ApplicationBatchStatus;
  progress: BatchProgress;
  claimedCount: number;
  stopReason: BatchRunStopReason;
  claimedDoneStatus: ApplicationBatchStatus | null;
  terminalStatus: ApplicationBatchStatus | null;
}): ApplicationBatchStatus {
  if (input.terminalStatus) return input.terminalStatus;
  if (input.claimedDoneStatus) return input.claimedDoneStatus;
  if (input.progress.pending > 0 || input.progress.running > 0) return "RUNNING";
  if (input.progress.failed > 0) return "FAILED";
  if (input.progress.succeeded > 0 || input.progress.skipped > 0) return "SUCCEEDED";
  if (input.claimedCount > 0 || input.stopReason === "LIMIT_REACHED") return "RUNNING";
  return input.initialBatchStatus;
}
