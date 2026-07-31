import { NextResponse } from "next/server";

import { errorJson } from "@/lib/server/api/errorResponse";
import { withAgentRoute } from "@/lib/server/api/routeHandler";
import {
  TAILORING_RUN_PROTOCOL,
  TailoringRunError,
} from "@/lib/server/tailoringRuns/tailoringRunProtocol";
import { getTailoringRunStatus } from "@/lib/server/tailoringRuns/tailoringRunService";
import { UuidParamSchema } from "@/lib/shared/schemas/common";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return withAgentRoute(
    req,
    async ({ userId, params, requestId }) => {
      try {
        const run = await getTailoringRunStatus(userId, params.id);
        return NextResponse.json({
          protocol: TAILORING_RUN_PROTOCOL,
          run,
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
