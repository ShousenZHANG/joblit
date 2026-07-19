import { NextResponse } from "next/server";
import { z } from "zod";

import { errorJson } from "@/lib/server/api/errorResponse";
import { checkRateLimit, rateLimitHeaders } from "@/lib/server/api/rateLimit";
import { unauthorizedError } from "@/lib/server/api/errorResponse";
import {
  requireSession,
  UnauthorizedError,
  type SessionContext,
} from "@/lib/server/auth/requireSession";
import { aggregateFitMatrix } from "@/lib/server/ai/fitScoring";
import { prisma } from "@/lib/server/prisma";
import { FitMatrixSchema } from "@/lib/shared/schemas/fitMatrix";

export const runtime = "nodejs";

const FIT_RATE_LIMIT = { limit: 60, windowSeconds: 60 } as const;
const MAX_MODEL_OUTPUT_CHARS = 80_000;

const ParamsSchema = z.object({ id: z.string().uuid() });
const BodySchema = z
  .object({
    modelOutput: z.string().min(2).max(MAX_MODEL_OUTPUT_CHARS),
    promptMeta: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

/** Extract the first JSON object from model output (tolerates stray prose). */
function extractJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

export async function POST(
  req: Request,
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

  const rateLimit = checkRateLimit(`jobs:fit:${userId}`, FIT_RATE_LIMIT);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: rateLimitHeaders(rateLimit) },
    );
  }

  const params = ParamsSchema.safeParse(await ctx.params);
  if (!params.success) {
    return NextResponse.json({ error: "INVALID_PARAMS" }, { status: 400 });
  }
  const body = BodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return errorJson("INVALID_BODY", "Invalid request body", 400, {
      details: body.error.flatten(),
    });
  }

  const parsedOutput = extractJsonObject(body.data.modelOutput);
  const matrix = FitMatrixSchema.safeParse(parsedOutput);
  if (!matrix.success) {
    const details = matrix.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`);
    return errorJson(
      "INVALID_AI_RESULT",
      "The fit matrix did not match the required schema.",
      400,
      { details },
    );
  }

  // The model judges requirements; the score is Joblit's deterministic call.
  const result = aggregateFitMatrix(matrix.data);
  const snapshotHash =
    typeof body.data.promptMeta?.resumeSnapshotUpdatedAt === "string"
      ? body.data.promptMeta.resumeSnapshotUpdatedAt
      : null;

  const updated = await prisma.job.updateMany({
    where: { id: params.data.id, userId },
    data: {
      fitScore: result.score,
      fitVerdict: result.verdict,
      fitEligibility: result.eligibility,
      fitMatrix: matrix.data,
      fitSource: "local_ai",
      fitScoredAt: new Date(),
      fitSnapshotHash: snapshotHash,
    },
  });
  if (updated.count === 0) {
    return NextResponse.json({ error: "JOB_NOT_FOUND" }, { status: 404 });
  }

  return NextResponse.json({
    jobId: params.data.id,
    fitScore: result.score,
    rawFitScore: result.rawScore,
    fitVerdict: result.verdict,
    fitEligibility: result.eligibility,
    gateStatus: result.gateStatus,
    gateCap: result.gateCap,
    criticalGaps: result.criticalGaps,
    typeScores: result.typeScores,
  });
}
