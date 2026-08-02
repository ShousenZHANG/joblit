import { NextResponse } from "next/server";
import { z } from "zod";

import { withAgentRoute } from "@/lib/server/api/routeHandler";
import { errorJson } from "@/lib/server/api/errorResponse";
import {
  FitBatchImportError,
  readFitBatchSettlementState,
} from "@/lib/server/jobs/fitBatchImport";

export const runtime = "nodejs";

const RequestSchema = z
  .object({
    issueKey: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export async function POST(req: Request) {
  return withAgentRoute(req, "fit:drain", async ({ userId }) => {
    const body = RequestSchema.safeParse(await req.json().catch(() => null));
    if (!body.success) {
      return errorJson("INVALID_BODY", "Invalid request body", 400, {
        details: body.error.flatten(),
      });
    }

    try {
      const view = await readFitBatchSettlementState(
        userId,
        body.data.issueKey,
      );
      const status =
        view.state === "UNSETTLED"
          ? "ACTIVE"
          : view.state === "SETTLED"
            ? "SETTLED"
            : "TERMINAL_WITHOUT_RECEIPT";
      return NextResponse.json(
        {
          settlement: view.settlement,
          status,
          ...(view.state === "UNSETTLED" && view.claim
            ? { claim: view.claim }
            : {}),
          ...(view.state === "TERMINAL_UNSETTLED"
            ? { terminalReason: view.claim.reason, claimId: view.claim.id }
            : {}),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (error) {
      if (error instanceof FitBatchImportError) {
        return errorJson(error.code, error.message, error.status, {
          details: error.details,
        });
      }
      throw error;
    }
  });
}
