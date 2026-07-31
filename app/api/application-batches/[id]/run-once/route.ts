import { NextResponse } from "next/server";
import { errorJson } from "@/lib/server/api/errorResponse";
import { withAgentRoute } from "@/lib/server/api/routeHandler";
import { UuidParamSchema } from "@/lib/shared/schemas/common";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import {
  getBatchLeaseRetryHint,
  getBatchProgress,
} from "@/lib/server/applicationBatches/runner";
import { getResumeProfile } from "@/lib/server/resumeProfile";
import {
  buildBatchRunContext,
  claimBatchRunTasks,
  completeBatchRunTasks,
  deriveBatchStatusFromRun,
} from "@/lib/server/applicationBatches/codexRunContext";

export const runtime = "nodejs";

const CompletedTaskSchema = z.object({
  taskId: z.string().uuid(),
  attemptId: z.string().uuid(),
  status: z.enum(["FAILED", "SKIPPED"]),
  error: z.string().trim().max(500).optional().nullable(),
}).strict();

const BodySchema = z.object({
  maxSteps: z.number().int().min(1).max(20).optional().default(1),
  completedTasks: z.array(CompletedTaskSchema).max(20).optional().default([]),
}).strict();

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withAgentRoute(
    req,
    "tailoring:execute",
    async ({ userId, params }) => {
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

      const profile = await getResumeProfile(userId);
      if (!profile) {
        return errorJson("NO_PROFILE", "Create and save your master resume before running codex batch.", 404);
      }

      const runContext = await buildBatchRunContext({ userId, profile });
      const completionResults = await completeBatchRunTasks({
        userId,
        batchId: batch.id,
        completedTasks: parsedBody.data.completedTasks,
      });

      const maxSteps = parsedBody.data.maxSteps;
      const claimed = await claimBatchRunTasks({
        userId,
        batchId: batch.id,
        batchStatus: batch.status,
        maxSteps,
      });

      if (claimed.kind === "not_found") {
        return errorJson("NOT_FOUND", "Not found", 404);
      }

      const progress = await getBatchProgress({
        userId,
        batchId: batch.id,
      });

      const batchStatus = deriveBatchStatusFromRun({
        initialBatchStatus: batch.status,
        progress,
        claimedCount: claimed.tasks.length,
        stopReason: claimed.stopReason,
        claimedDoneStatus: claimed.doneStatus,
        terminalStatus: claimed.terminalStatus,
      });
      const leaseRetryHint =
        claimed.tasks.length === 0 &&
        batchStatus === "RUNNING" &&
        progress.running > 0
          ? await getBatchLeaseRetryHint({
              userId,
              batchId: batch.id,
            })
          : null;
      const executionStopReason = leaseRetryHint
        ? "LEASE_ACTIVE"
        : claimed.stopReason;

      return NextResponse.json({
        batch: {
          id: batch.id,
          scope: batch.scope,
          status: batchStatus,
          totalCount: batch.totalCount,
          error: batch.error,
        },
        progress,
        context: runContext,
        tasks: claimed.tasks,
        execution: {
          requestedMaxSteps: maxSteps,
          claimedCount: claimed.tasks.length,
          completedCount: completionResults.filter((result) => result.accepted).length,
          completionResults,
          stopReason: executionStopReason,
          retryAfterMs: leaseRetryHint?.retryAfterMs ?? null,
          earliestLeaseExpiresAt:
            leaseRetryHint?.earliestLeaseExpiresAt ?? null,
        },
      });
    },
    { params: ctx.params, schema: UuidParamSchema },
  );
}

