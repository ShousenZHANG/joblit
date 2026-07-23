import { NextResponse } from "next/server";
import { withSessionRoute } from "@/lib/server/api/routeHandler";
import { UuidParamSchema } from "@/lib/shared/schemas/common";
import { z } from "zod";

import { errorJson } from "@/lib/server/api/errorResponse";
import { checkRateLimit, rateLimitHeaders } from "@/lib/server/api/rateLimit";
import { aggregateFitMatrix } from "@/lib/server/ai/fitScoring";
import { prisma } from "@/lib/server/prisma";
import { FitMatrixSchema } from "@/lib/shared/schemas/fitMatrix";

export const runtime = "nodejs";

const FIT_RATE_LIMIT = { limit: 60, windowSeconds: 60 } as const;
const MAX_MODEL_OUTPUT_CHARS = 80_000;

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
  return withSessionRoute(
    async ({ userId, params }) => {
      const rateLimit = checkRateLimit(`jobs:fit:${userId}`, FIT_RATE_LIMIT);
      if (!rateLimit.allowed) {
        return NextResponse.json(
          { error: "Too many requests" },
          { status: 429, headers: rateLimitHeaders(rateLimit) },
        );
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
        where: { id: params.id, userId },
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
        return errorJson("JOB_NOT_FOUND", "Job not found", 404);
      }

      return NextResponse.json({
        jobId: params.id,
        fitScore: result.score,
        rawFitScore: result.rawScore,
        fitVerdict: result.verdict,
        fitEligibility: result.eligibility,
        gateStatus: result.gateStatus,
        gateCap: result.gateCap,
        criticalGaps: result.criticalGaps,
        typeScores: result.typeScores,
      });
    },
    { params: ctx.params, schema: UuidParamSchema },
  );
}
