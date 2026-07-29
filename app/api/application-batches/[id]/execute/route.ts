import { NextResponse } from "next/server";
import { errorJson } from "@/lib/server/api/errorResponse";
import { AppError } from "@/lib/server/api/appError";
import { withSessionRoute } from "@/lib/server/api/routeHandler";
import { UuidParamSchema } from "@/lib/shared/schemas/common";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import {
  BatchRunnerError,
  claimNextBatchTask,
  completeBatchTask,
  getBatchProgress,
} from "@/lib/server/applicationBatches/runner";
import { executeServerBatchTailoringTask } from "@/lib/server/applications/executeServerBatchTailoringTask";
import {
  deriveBatchStatusFromRun,
  type BatchRunStopReason,
} from "@/lib/server/applicationBatches/codexRunContext";
import type { ApplicationBatchStatus } from "@/lib/generated/prisma";
import { reportError } from "@/lib/server/observability/errorReporter";
import { getRuntimeCapabilities } from "@/lib/server/runtimeCapabilities";

export const runtime = "nodejs";

function isAutoExecuteEnabled() {
  return getRuntimeCapabilities().batchAutogeneration.kind === "enabled";
}

const BodySchema = z.object({
  maxSteps: z.coerce.number().int().min(1).max(50).optional().default(20),
});

const TERMINAL_BATCH_STATUSES = new Set(["SUCCEEDED", "FAILED", "CANCELLED"]);

function toTaskErrorMessage(error: unknown) {
  if (error instanceof AppError) {
    const publicMessage = error.publicMessage.trim() || error.code;
    return publicMessage.slice(0, 500);
  }
  return "TASK_FAILED";
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withSessionRoute(
    async ({ userId, params }) => {
      if (!isAutoExecuteEnabled()) {
        return errorJson("EXECUTE_DISABLED", "Server-side auto execute is disabled. Use /codex-run with /applications/prompt and /applications/manual-generate.", 410);
      }

      const json = await req.json().catch(() => ({}));
      const parsedBody = BodySchema.safeParse(json ?? {});
      if (!parsedBody.success) {
        return errorJson("INVALID_BODY", "Invalid request body", 400, {
          details: parsedBody.error.flatten(),
        });
      }

      const batch = await prisma.applicationBatch.findFirst({
        where: {
          id: params.id,
          userId,
        },
        select: {
          id: true,
          scope: true,
          status: true,
          totalCount: true,
          error: true,
        },
      });
      if (!batch) return errorJson("NOT_FOUND", "Not found", 404);

      const maxSteps = parsedBody.data.maxSteps;
      const tasks: Array<{
        taskId: string;
        jobId: string;
        job: {
          title: string;
          company: string | null;
          jobUrl: string;
        };
        status: "SUCCEEDED" | "FAILED";
        error: string | null;
        artifacts: {
          resumePdfUrl: string | null;
          coverPdfUrl: string | null;
        };
      }> = [];

      let stopReason: BatchRunStopReason = "LIMIT_REACHED";
      let terminalStatus: ApplicationBatchStatus | null = null;
      let doneStatus: ApplicationBatchStatus | null = null;

      if (!TERMINAL_BATCH_STATUSES.has(batch.status)) {
        for (let i = 0; i < maxSteps; i += 1) {
          const claimed = await claimNextBatchTask({
            userId,
            batchId: batch.id,
          });

          if (claimed.kind === "not_found") {
            return errorJson("NOT_FOUND", "Not found", 404);
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

          const taskBase = {
            taskId: claimed.task.id,
            jobId: claimed.task.jobId,
            job: {
              title: claimed.task.title,
              company: claimed.task.company,
              jobUrl: claimed.task.jobUrl,
            },
          };

          try {
            const artifactResult = await executeServerBatchTailoringTask({
              userId,
              jobId: claimed.task.jobId,
              batchId: batch.id,
              taskId: claimed.task.id,
              executionAttemptId: claimed.task.attemptId,
              issueKey: claimed.task.issueKey,
            });
            tasks.push({
              ...taskBase,
              status: "SUCCEEDED",
              error: null,
              artifacts: {
                resumePdfUrl: artifactResult.resumePdfUrl,
                coverPdfUrl: artifactResult.coverPdfUrl,
              },
            });
          } catch (error) {
            const failureMessage = toTaskErrorMessage(error);
            reportError(error, {
              scope: "application-batches.execute.task",
              userId,
              tags: {
                batchId: batch.id,
                taskId: claimed.task.id,
                jobId: claimed.task.jobId,
                code: error instanceof AppError ? error.code : "TASK_FAILED",
              },
              ...(error instanceof AppError && error.privateDetails !== undefined
                ? { extra: { details: error.privateDetails } }
                : {}),
            });
            try {
              await completeBatchTask({
                userId,
                batchId: batch.id,
                taskId: claimed.task.id,
                attemptId: claimed.task.attemptId,
                status: "FAILED",
                error: failureMessage,
              });
            } catch (completionError) {
              if (!(completionError instanceof BatchRunnerError)) {
                throw completionError;
              }
            }
            tasks.push({
              ...taskBase,
              status: "FAILED",
              error: failureMessage,
              artifacts: {
                resumePdfUrl: null,
                coverPdfUrl: null,
              },
            });
          }
        }
      } else {
        terminalStatus = batch.status;
        stopReason = "BATCH_TERMINAL";
      }

      const progress = await getBatchProgress({
        userId,
        batchId: batch.id,
      });

      const batchStatus = deriveBatchStatusFromRun({
        initialBatchStatus: batch.status,
        progress,
        claimedCount: tasks.length,
        stopReason,
        claimedDoneStatus: doneStatus,
        terminalStatus,
      });

      return NextResponse.json({
        batch: {
          id: batch.id,
          scope: batch.scope,
          status: batchStatus,
          totalCount: batch.totalCount,
          error: batch.error,
        },
        progress,
        tasks,
        execution: {
          requestedMaxSteps: maxSteps,
          processedCount: tasks.length,
          successCount: tasks.filter((task) => task.status === "SUCCEEDED").length,
          failedCount: tasks.filter((task) => task.status === "FAILED").length,
          stopReason,
        },
      });
    },
    { params: ctx.params, schema: UuidParamSchema },
  );
}
