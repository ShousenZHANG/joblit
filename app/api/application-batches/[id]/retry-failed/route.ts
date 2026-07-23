import { NextResponse } from "next/server";
import { errorJson } from "@/lib/server/api/errorResponse";
import { withSessionRoute } from "@/lib/server/api/routeHandler";
import { UuidParamSchema } from "@/lib/shared/schemas/common";
import { z } from "zod";
import { BatchRunnerError, createRetryBatchFromFailed } from "@/lib/server/applicationBatches/runner";

export const runtime = "nodejs";

const BodySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withSessionRoute(
    async ({ userId, params }) => {
      const json = await req.json().catch(() => ({}));
      const parsedBody = BodySchema.safeParse(json ?? {});
      if (!parsedBody.success) {
        return errorJson("INVALID_BODY", "Invalid request body", 400, {
          details: parsedBody.error.flatten(),
        });
      }

      try {
        const result = await createRetryBatchFromFailed({
          userId,
          sourceBatchId: params.id,
          limit: parsedBody.data.limit,
        });
        return NextResponse.json(result, { status: 201 });
      } catch (error) {
        if (error instanceof BatchRunnerError && error.code === "NOT_FOUND") {
          return errorJson("NOT_FOUND", "Not found", 404);
        }
        if (error instanceof BatchRunnerError && error.code === "INVALID_STATE") {
          return errorJson("INVALID_STATE", error.message, 409);
        }
        throw error;
      }
    },
    { params: ctx.params, schema: UuidParamSchema },
  );
}
