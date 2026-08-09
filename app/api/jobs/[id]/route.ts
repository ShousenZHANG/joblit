import { NextResponse } from "next/server";
import { errorJson } from "@/lib/server/api/errorResponse";
import { withSessionRoute } from "@/lib/server/api/routeHandler";
import { UuidParamSchema } from "@/lib/shared/schemas/common";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { deleteJob } from "@/lib/server/jobs/jobDeleteService";
import { updateJobStatus } from "@/lib/server/jobs/jobStatusService";
import { ACTIVE_JOB_STATUS_VALUES } from "@/lib/shared/jobStatus";
import { applicationEventErrorResponse } from "@/lib/server/applications/applicationEventErrors";
import { analyzeJobExperience } from "@/lib/shared/jobExperienceAnalysis";
import {
  projectJobExperienceAnalysisV1,
  projectJobExperienceAnalysisV2,
} from "@/lib/shared/jobExperienceAnalysisCompat";

export const runtime = "nodejs";

// Writes are restricted to the active triage states. Retired statuses stay
// parseable elsewhere for ledger history, but nothing may create a new one.
const PatchSchema = z.object({
  status: z.enum(ACTIVE_JOB_STATUS_VALUES).optional(),
});

export async function PATCH(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return withSessionRoute(
    async ({ userId, params }) => {
      const json = await _req.json().catch(() => null);
      const parsedBody = PatchSchema.safeParse(json);
      if (!parsedBody.success) {
        return errorJson("INVALID_BODY", "Invalid request body", 400, {
          details: parsedBody.error.flatten(),
        });
      }

      let result;
      try {
        result = await updateJobStatus(
          userId,
          params.id,
          parsedBody.data.status,
        );
      } catch (error) {
        const response = applicationEventErrorResponse(error);
        if (response) return response;
        throw error;
      }
      if (!result) {
        return errorJson("NOT_FOUND", "Not found", 404);
      }

      return NextResponse.json(result);
    },
    { params: ctx.params, schema: UuidParamSchema },
  );
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return withSessionRoute(
    async ({ userId, params }) => {
      const job = await prisma.job.findFirst({
        where: { id: params.id, userId },
        select: {
          id: true,
          description: true,
          updatedAt: true,
        },
      });

      if (!job) {
        return errorJson("NOT_FOUND", "Not found", 404);
      }

      const experienceAnalysisV3 = analyzeJobExperience(job.description);
      return NextResponse.json({
        id: job.id,
        description: job.description ?? null,
        // This is deliberately derived from the authoritative description on
        // read. Experience years are not filter/sort data, so persisting a
        // second copy would create a stale-cache and production-backfill
        // problem without improving the user-visible result.
        experienceAnalysis:
          projectJobExperienceAnalysisV1(experienceAnalysisV3),
        experienceAnalysisV2:
          projectJobExperienceAnalysisV2(experienceAnalysisV3),
        experienceAnalysisV3,
        updatedAt: job.updatedAt.toISOString(),
      });
    },
    { params: ctx.params, schema: UuidParamSchema },
  );
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return withSessionRoute(
    async ({ userId, params }) => {
      const result = await deleteJob(userId, params.id);
      return NextResponse.json({ ok: true, ...result });
    },
    { params: ctx.params, schema: UuidParamSchema },
  );
}
