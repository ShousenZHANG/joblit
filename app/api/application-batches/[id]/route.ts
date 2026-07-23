import { NextResponse } from "next/server";
import { errorJson } from "@/lib/server/api/errorResponse";
import { prisma } from "@/lib/server/prisma";
import { withSessionRoute } from "@/lib/server/api/routeHandler";
import { UuidParamSchema } from "@/lib/shared/schemas/common";
import { taskProgressFromGroupBy } from "@/lib/server/applicationBatches/batchProgress";

export async function GET(
  _req: Request,
  context: {
    params: Promise<{ id: string }>;
  },
) {
  return withSessionRoute(
    async ({ userId, params }) => {
      const { id } = params;

      const batch = await prisma.applicationBatch.findFirst({
        where: {
          id,
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

      if (!batch) {
        return errorJson("NOT_FOUND", "Not found", 404);
      }

      const grouped = await prisma.applicationBatchTask.groupBy({
        by: ["status"],
        where: {
          batchId: id,
          userId,
        },
        _count: {
          _all: true,
        },
      });

      const nextTask = await prisma.applicationBatchTask.findFirst({
        where: {
          batchId: id,
          userId,
          status: "PENDING",
        },
        orderBy: {
          createdAt: "asc",
        },
        select: {
          id: true,
          jobId: true,
          job: {
            select: {
              title: true,
              company: true,
              jobUrl: true,
            },
          },
        },
      });

      const progress = taskProgressFromGroupBy(grouped);

      return NextResponse.json({
        batch,
        progress,
        nextTask: nextTask
          ? {
              id: nextTask.id,
              jobId: nextTask.jobId,
              jobTitle: nextTask.job.title,
              company: nextTask.job.company,
              jobUrl: nextTask.job.jobUrl,
            }
          : null,
      });
    },
    { params: context.params, schema: UuidParamSchema },
  );
}
