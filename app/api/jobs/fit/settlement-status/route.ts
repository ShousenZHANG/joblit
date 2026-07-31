import { NextResponse } from "next/server";
import { z } from "zod";

import { withAgentRoute } from "@/lib/server/api/routeHandler";
import { errorJson } from "@/lib/server/api/errorResponse";
import {
  FitBatchImportError,
  readFitBatchSettlement,
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
      const settlement = await readFitBatchSettlement(
        userId,
        body.data.issueKey,
      );
      return NextResponse.json(
        { settlement },
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
