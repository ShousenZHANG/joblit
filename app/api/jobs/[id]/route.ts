import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { requireSession, UnauthorizedError } from "@/lib/server/auth/requireSession";
import type { SessionContext } from "@/lib/server/auth/requireSession";
import { unauthorizedError } from "@/lib/server/api/errorResponse";
import { deleteJob } from "@/lib/server/jobs/jobDeleteService";
import { updateJobStatus } from "@/lib/server/jobs/jobStatusService";
import { FitMatrixSchema } from "@/lib/shared/schemas/fitMatrix";
import { ACTIVE_JOB_STATUS_VALUES } from "@/lib/shared/jobStatus";
import { applicationEventErrorResponse } from "@/lib/server/applications/applicationEventErrors";

export const runtime = "nodejs";

const ParamsSchema = z.object({
  id: z.string().uuid(),
});

// Writes are restricted to the active triage states. Retired statuses stay
// parseable elsewhere for ledger history, but nothing may create a new one.
const PatchSchema = z.object({
  status: z.enum(ACTIVE_JOB_STATUS_VALUES).optional(),
});

export async function PATCH(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  let session: SessionContext;
  try {
    session = await requireSession();
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedError();
    throw err;
  }
  const { userId } = session;

  const params = await ctx.params;
  const parsedParams = ParamsSchema.safeParse(params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: "INVALID_PARAMS" }, { status: 400 });
  }

  const json = await _req.json().catch(() => null);
  const parsedBody = PatchSchema.safeParse(json);
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: "INVALID_BODY", details: parsedBody.error.flatten() },
      { status: 400 },
    );
  }

  let result;
  try {
    result = await updateJobStatus(
      userId,
      parsedParams.data.id,
      parsedBody.data.status,
    );
  } catch (error) {
    const response = applicationEventErrorResponse(error);
    if (response) return response;
    throw error;
  }
  if (!result) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  return NextResponse.json(result);
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  let session: SessionContext;
  try {
    session = await requireSession();
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedError();
    throw err;
  }
  const { userId } = session;

  const params = await ctx.params;
  const parsedParams = ParamsSchema.safeParse(params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: "INVALID_PARAMS" }, { status: 400 });
  }

  const job = await prisma.job.findFirst({
    where: { id: parsedParams.data.id, userId },
    select: { id: true, description: true, fitMatrix: true, updatedAt: true },
  });

  if (!job) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const matrix = FitMatrixSchema.safeParse(job.fitMatrix);
  return NextResponse.json({
    id: job.id,
    description: job.description ?? null,
    fitMatrix: matrix.success ? matrix.data : null,
    updatedAt: job.updatedAt.toISOString(),
  });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  let session: SessionContext;
  try {
    session = await requireSession();
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedError();
    throw err;
  }
  const { userId } = session;

  const params = await ctx.params;
  const parsedParams = ParamsSchema.safeParse(params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: "INVALID_PARAMS" }, { status: 400 });
  }

  const result = await deleteJob(userId, parsedParams.data.id);
  return NextResponse.json({ ok: true, ...result });
}
