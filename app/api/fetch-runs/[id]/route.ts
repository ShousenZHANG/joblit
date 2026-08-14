import { NextResponse } from "next/server";
import { errorJson } from "@/lib/server/api/errorResponse";
import { withSessionRoute } from "@/lib/server/api/routeHandler";
import { getFetchRunStatus } from "@/lib/server/fetchRuns/fetchRun";
import { UuidParamSchema } from "@/lib/shared/schemas/common";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withSessionRoute(
    async ({ userId, params }) => {
      const run = await getFetchRunStatus({ runId: params.id, userId });
      if (!run) return errorJson("NOT_FOUND", "Not found", 404);
      return NextResponse.json({ run });
    },
    { params: ctx.params, schema: UuidParamSchema },
  );
}

