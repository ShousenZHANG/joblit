import { NextResponse } from "next/server";
import { z } from "zod";
import { errorJson } from "@/lib/server/api/errorResponse";
import { withSessionRoute } from "@/lib/server/api/routeHandler";
import { getApplicationBatchPreflight } from "@/lib/server/applicationBatches/batchEligibility";

export const runtime = "nodejs";

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export async function GET(req: Request) {
  return withSessionRoute(async ({ userId }) => {
    const url = new URL(req.url);
    const parsed = QuerySchema.safeParse({
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) {
      return errorJson("INVALID_QUERY", "Invalid query parameters", 400, {
        details: parsed.error.flatten(),
      });
    }

    const preflight = await getApplicationBatchPreflight({
      userId,
      limit: parsed.data.limit,
    });
    return NextResponse.json(preflight);
  });
}
