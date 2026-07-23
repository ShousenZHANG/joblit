import { NextResponse } from "next/server";
import { errorJson } from "@/lib/server/api/errorResponse";
import { claimNextBatchTask } from "@/lib/server/applicationBatches/runner";
import { withSessionRoute } from "@/lib/server/api/routeHandler";
import { UuidParamSchema } from "@/lib/shared/schemas/common";

export const runtime = "nodejs";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withSessionRoute(
    async ({ userId, params }) => {
      const claimed = await claimNextBatchTask({
        userId,
        batchId: params.id,
      });

      if (claimed.kind === "not_found") {
        return errorJson("NOT_FOUND", "Not found", 404);
      }

      return NextResponse.json(claimed, { status: 200 });
    },
    { params: ctx.params, schema: UuidParamSchema },
  );
}
