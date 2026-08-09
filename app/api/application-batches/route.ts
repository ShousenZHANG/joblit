import { NextResponse } from "next/server";
import { errorJson } from "@/lib/server/api/errorResponse";
import { withSessionRoute } from "@/lib/server/api/routeHandler";
import { z } from "zod";
import { queueApplicationBatch } from "@/lib/server/applicationBatches/queueApplicationBatch";

export const runtime = "nodejs";

const CreateBatchSchema = z.object({
  scope: z.enum(["NEW"]).default("NEW"),
  limit: z.coerce.number().int().min(1).max(200).optional().default(100),
});

export async function POST(req: Request) {
  return withSessionRoute(async ({ userId }) => {
    const json = await req.json().catch(() => ({}));
    const parsed = CreateBatchSchema.safeParse(json ?? {});
    if (!parsed.success) {
      return errorJson("INVALID_BODY", "Invalid request body", 400, {
        details: parsed.error.flatten(),
      });
    }

    const outcome = await queueApplicationBatch({
      userId,
      seed: {
        kind: "new",
        limit: parsed.data.limit,
      },
    });

    if (outcome.kind === "active_exists") {
      return errorJson(
        "ACTIVE_BATCH_EXISTS",
        "An active batch already exists",
        409,
        {
          details: {
            batchId: outcome.activeBatch.id,
            status: outcome.activeBatch.status,
          },
        },
      );
    }
    if (outcome.kind === "profile_missing") {
      return errorJson(
        "NO_PROFILE",
        "Create and save your Master Resume Profile before generating Applications.",
        409,
      );
    }
    if (outcome.kind === "empty") {
      return errorJson("NO_ELIGIBLE_JOBS", "No eligible jobs", 400);
    }
    if (outcome.kind !== "queued") {
      throw new Error("Unexpected Application Batch queue outcome");
    }

    return NextResponse.json({ batch: outcome.batch }, { status: 201 });
  });
}
