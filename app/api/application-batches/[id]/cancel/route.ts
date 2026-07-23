import { NextResponse } from "next/server";
import { errorJson } from "@/lib/server/api/errorResponse";
import { BatchRunnerError, cancelBatch } from "@/lib/server/applicationBatches/runner";
import { withSessionRoute } from "@/lib/server/api/routeHandler";
import { UuidParamSchema } from "@/lib/shared/schemas/common";

export const runtime = "nodejs";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withSessionRoute(
    async ({ userId, params }) => {
      try {
        const result = await cancelBatch({
          userId,
          batchId: params.id,
        });
        return NextResponse.json(result, { status: 200 });
      } catch (error) {
        if (error instanceof BatchRunnerError && error.code === "NOT_FOUND") {
          return errorJson("NOT_FOUND", "Not found", 404);
        }
        throw error;
      }
    },
    { params: ctx.params, schema: UuidParamSchema },
  );
}
