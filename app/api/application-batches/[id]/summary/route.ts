import { NextResponse } from "next/server";
import { withSessionRoute } from "@/lib/server/api/routeHandler";
import { UuidParamSchema } from "@/lib/shared/schemas/common";
import { prisma } from "@/lib/server/prisma";
import { taskProgressFromGroupBy } from "@/lib/server/applicationBatches/batchProgress";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withSessionRoute(
    async ({ userId, params }) => {
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
          createdAt: true,
          updatedAt: true,
          startedAt: true,
          completedAt: true,
        },
      });

      if (!batch) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

      const grouped = await prisma.applicationBatchTask.groupBy({
        by: ["status"],
        where: {
          batchId: batch.id,
          userId,
        },
        _count: {
          _all: true,
        },
      });
      const progress = taskProgressFromGroupBy(grouped);

      const [failedTasks, succeededTasks] = await Promise.all([
        prisma.applicationBatchTask.findMany({
          where: {
            batchId: batch.id,
            userId,
            status: "FAILED",
          },
          orderBy: [{ updatedAt: "desc" }],
          take: 100,
          select: {
            id: true,
            jobId: true,
            status: true,
            error: true,
            attempt: true,
            updatedAt: true,
            job: {
              select: {
                title: true,
                company: true,
                jobUrl: true,
              },
            },
          },
        }),
        prisma.applicationBatchTask.findMany({
          where: {
            batchId: batch.id,
            userId,
            status: "SUCCEEDED",
          },
          orderBy: [{ completedAt: "desc" }, { updatedAt: "desc" }],
          take: 100,
          select: {
            id: true,
            jobId: true,
            status: true,
            completedAt: true,
            updatedAt: true,
            job: {
              select: {
                title: true,
                company: true,
                jobUrl: true,
              },
            },
          },
        }),
      ]);

      const succeededJobIds = Array.from(new Set(succeededTasks.map((task) => task.jobId)));
      const applicationArtifacts =
        succeededJobIds.length > 0
          ? await prisma.application.findMany({
              where: {
                userId,
                jobId: { in: succeededJobIds },
              },
              select: {
                jobId: true,
                resumePdfUrl: true,
                coverPdfUrl: true,
              },
            })
          : [];
      const artifactsByJobId = new Map(applicationArtifacts.map((item) => [item.jobId, item]));

      return NextResponse.json({
        batch: {
          ...batch,
          createdAt: batch.createdAt.toISOString(),
          updatedAt: batch.updatedAt.toISOString(),
          startedAt: batch.startedAt?.toISOString() ?? null,
          completedAt: batch.completedAt?.toISOString() ?? null,
        },
        progress,
        remainingCount: progress.pending + progress.running,
        failed: failedTasks.map((task) => ({
          taskId: task.id,
          jobId: task.jobId,
          jobTitle: task.job.title,
          company: task.job.company,
          jobUrl: task.job.jobUrl,
          attempt: task.attempt,
          error: task.error ?? "TASK_FAILED",
          updatedAt: task.updatedAt.toISOString(),
        })),
        succeeded: succeededTasks.map((task) => {
          const artifacts = artifactsByJobId.get(task.jobId);
          return {
            taskId: task.id,
            jobId: task.jobId,
            jobTitle: task.job.title,
            company: task.job.company,
            jobUrl: task.job.jobUrl,
            completedAt: (task.completedAt ?? task.updatedAt).toISOString(),
            artifacts: {
              resumePdfUrl: artifacts?.resumePdfUrl ?? null,
              coverPdfUrl: artifacts?.coverPdfUrl ?? null,
            },
          };
        }),
      });
    },
    { params: ctx.params, schema: UuidParamSchema },
  );
}

