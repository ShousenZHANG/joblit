import { NextResponse } from "next/server";
import { errorJson } from "@/lib/server/api/errorResponse";
import { withSessionRoute } from "@/lib/server/api/routeHandler";
import { UuidParamSchema } from "@/lib/shared/schemas/common";

export const runtime = "nodejs";

export async function POST(req: Request, routeCtx: { params: Promise<{ id: string }> }) {
  return withSessionRoute(
    async ({ userId, params }) => {
      void req;
      void userId;

      return errorJson("TRIGGER_DISABLED", "Automatic trigger execution is disabled. Use /codex-run and manual-generate flow from Codex.", 410, {
        details: { batchId: params.id },
      });
    },
    { params: routeCtx.params, schema: UuidParamSchema },
  );
}
