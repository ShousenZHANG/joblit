import { NextResponse } from "next/server";
import { z } from "zod";

import { errorJson, validationError } from "@/lib/server/api/errorResponse";
import { withAgentRoute } from "@/lib/server/api/routeHandler";
import {
  TAILORING_RUN_PROTOCOL,
  TailoringRunError,
} from "@/lib/server/tailoringRuns/tailoringRunProtocol";
import { failTailoringRun } from "@/lib/server/tailoringRuns/tailoringRunService";
import { UuidParamSchema } from "@/lib/shared/schemas/common";

export const runtime = "nodejs";

const BodySchema = z
  .object({
    attemptId: z.string().uuid(),
    code: z.string().trim().regex(/^[A-Z][A-Z0-9_]{0,79}$/),
    message: z.string().trim().max(500).optional(),
  })
  .strict();

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return withAgentRoute(
    req,
    "tailoring:control",
    async ({ userId, params, requestId }) => {
      const parsed = BodySchema.safeParse(await req.json().catch(() => null));
      if (!parsed.success) return validationError(parsed.error, requestId);
      try {
        const result = await failTailoringRun({
          userId,
          handle: { id: params.id, attemptId: parsed.data.attemptId },
          errorCode: parsed.data.code,
          errorMessage: parsed.data.message,
          batchExecutionAttemptId: parsed.data.attemptId,
        });
        return NextResponse.json({
          protocol: TAILORING_RUN_PROTOCOL,
          ...result,
          requestId,
        });
      } catch (error) {
        if (error instanceof TailoringRunError) {
          return errorJson(error.code, error.message, error.status, { requestId });
        }
        throw error;
      }
    },
    { params: ctx.params, schema: UuidParamSchema },
  );
}
