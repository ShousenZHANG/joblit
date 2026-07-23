import { NextResponse } from "next/server";
import { withSessionRoute } from "@/lib/server/api/routeHandler";
import { UuidParamSchema } from "@/lib/shared/schemas/common";

export const runtime = "nodejs";

export async function POST(req: Request, routeCtx: { params: Promise<{ id: string }> }) {
  return withSessionRoute(
    async ({ userId, params }) => {
      void req;
      void userId;

      return NextResponse.json(
        {
          error: "TRIGGER_DISABLED",
          message:
            "Automatic trigger execution is disabled. Use /codex-run and manual-generate flow from Codex.",
          batchId: params.id,
        },
        { status: 410 },
      );
    },
    { params: routeCtx.params, schema: UuidParamSchema },
  );
}
