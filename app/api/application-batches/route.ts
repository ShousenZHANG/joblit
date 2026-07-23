import { NextResponse } from "next/server";
import { errorJson } from "@/lib/server/api/errorResponse";
import { withSessionRoute } from "@/lib/server/api/routeHandler";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";

export const runtime = "nodejs";

const ACTIVE_BATCH_STATUSES = ["QUEUED", "RUNNING"] as const;

const CreateBatchSchema = z.object({
  scope: z.enum(["NEW"]).default("NEW"),
  limit: z.coerce.number().int().min(1).max(200).optional().default(100),
  selectedJobIds: z.array(z.string().uuid()).min(1).max(200).optional(),
});

export async function POST(req: Request) {
  return withSessionRoute(async ({ userId }) => {
    const json = await req.json().catch(() => ({}));
    const parsed = CreateBatchSchema.safeParse(json ?? {});
    if (!parsed.success) {
      return errorJson("INVALID_BODY", "Invalid request body", 400, {
        details: parsed.error.flatten(),
      });
    }

    const activeBatch = await prisma.applicationBatch.findFirst({
      where: {
        userId,
        status: {
          in: [...ACTIVE_BATCH_STATUSES],
        },
      },
      select: {
        id: true,
        status: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (activeBatch) {
      return errorJson("ACTIVE_BATCH_EXISTS", "An active batch already exists", 409, {
        details: { batchId: activeBatch.id, status: activeBatch.status },
      });
    }

    const selectedJobIds = parsed.data.selectedJobIds
      ? Array.from(new Set(parsed.data.selectedJobIds))
      : [];
    const jobs = await prisma.job.findMany({
      where: {
        userId,
        status: "NEW",
        ...(selectedJobIds.length > 0
          ? {
              id: {
                in: selectedJobIds,
              },
            }
          : {}),
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      ...(selectedJobIds.length === 0 ? { take: parsed.data.limit } : {}),
      select: {
        id: true,
        title: true,
        company: true,
        jobUrl: true,
      },
    });

    if (jobs.length === 0) {
      return errorJson("NO_ELIGIBLE_JOBS", "No eligible jobs", 400);
    }

    const batch = await prisma.$transaction(async (tx) => {
      const createdBatch = await tx.applicationBatch.create({
        data: {
          userId,
          scope: parsed.data.scope,
          status: "QUEUED",
          totalCount: jobs.length,
        },
        select: {
          id: true,
          scope: true,
          status: true,
          totalCount: true,
          createdAt: true,
        },
      });

      await tx.applicationBatchTask.createMany({
        data: jobs.map((job) => ({
          batchId: createdBatch.id,
          userId,
          jobId: job.id,
          status: "PENDING",
        })),
        skipDuplicates: true,
      });

      return createdBatch;
    });

    return NextResponse.json({ batch }, { status: 201 });
  });
}
