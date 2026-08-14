import { NextResponse } from "next/server";
import { errorJson } from "@/lib/server/api/errorResponse";
import { withSessionRoute } from "@/lib/server/api/routeHandler";
import {
  cancelFetchRun,
  type FetchRunCancelResult,
} from "@/lib/server/fetchRuns/fetchRun";
import { UuidParamSchema } from "@/lib/shared/schemas/common";

export const runtime = "nodejs";

function cancelResultResponse(result: FetchRunCancelResult): NextResponse {
  if (result.kind === "not_found") {
    return errorJson("NOT_FOUND", "Not found", 404);
  }
  if (result.kind === "finished") {
    return errorJson("ALREADY_FINISHED", "The fetch run already finished", 409, {
      details: { status: result.status },
    });
  }
  return NextResponse.json({ ok: true, status: result.status });
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withSessionRoute(
    async ({ userId, params }) => {
      const result = await cancelFetchRun({ runId: params.id, userId });
      return cancelResultResponse(result);
    },
    { params: ctx.params, schema: UuidParamSchema },
  );
}
