import { NextResponse } from "next/server";
import { z } from "zod";
import { withSessionRoute } from "@/lib/server/api/routeHandler";
import { batchDeleteJobs } from "@/lib/server/jobs/jobDeleteService";

export const runtime = "nodejs";

const MAX_BATCH_SIZE = 100;

const BodySchema = z.object({
  ids: z
    .array(z.string().uuid())
    .min(1, "At least one ID is required")
    .max(MAX_BATCH_SIZE, `Maximum ${MAX_BATCH_SIZE} jobs per batch`)
    .transform((ids) => Array.from(new Set(ids))),
});

export async function POST(req: Request) {
  return withSessionRoute(async ({ userId }) => {
    const json = await req.json().catch(() => null);
    const parsed = BodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "INVALID_BODY", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const result = await batchDeleteJobs(userId, parsed.data.ids);
    return NextResponse.json({ ok: true, ...result });
  });
}
