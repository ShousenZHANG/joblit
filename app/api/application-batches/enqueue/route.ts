import { NextResponse } from "next/server";
import { z } from "zod";
import { errorJson } from "@/lib/server/api/errorResponse";
import { withSessionRoute } from "@/lib/server/api/routeHandler";
import {
  MAX_ENQUEUE_JOBS_PER_REQUEST,
  enqueueJobsForTailoring,
} from "@/lib/server/applicationBatches/enqueueJobsForTailoring";

export const runtime = "nodejs";

const EnqueueSchema = z.object({
  jobIds: z
    .array(z.string().uuid())
    .min(1)
    .max(MAX_ENQUEUE_JOBS_PER_REQUEST),
});

/**
 * Add specific Jobs to the tailoring queue.
 *
 * Deliberately not `POST /api/application-batches`, which owns "queue every
 * eligible Job and refuse if one is already running". That route answers 409
 * ACTIVE_BATCH_EXISTS by design; this one appends instead, because a user
 * asking for one Job should never have to know whether a batch happens to be
 * draining right now.
 */
export async function POST(req: Request) {
  return withSessionRoute(async ({ userId, requestId }) => {
    const json = await req.json().catch(() => null);
    const parsed = EnqueueSchema.safeParse(json ?? {});
    if (!parsed.success) {
      return errorJson("INVALID_BODY", "Invalid request body", 400, {
        details: parsed.error.flatten(),
        requestId,
      });
    }

    const outcome = await enqueueJobsForTailoring({
      userId,
      jobIds: parsed.data.jobIds,
    });

    if (outcome.kind === "profile_missing") {
      return errorJson(
        "NO_PROFILE",
        "Create and save your Master Resume Profile before generating Applications.",
        409,
        { requestId },
      );
    }
    if (outcome.kind === "empty") {
      return errorJson("NO_ELIGIBLE_JOBS", "No eligible jobs", 400, {
        requestId,
      });
    }
    if (outcome.kind === "none_eligible") {
      // Every requested Job was already generated, not AU, or no longer NEW.
      // 409 rather than 400: the request was well formed, the world moved.
      return errorJson(
        "NO_ELIGIBLE_JOBS",
        "These jobs cannot be generated: they already have an application, or are no longer new.",
        409,
        { details: { ineligibleJobIds: outcome.ineligibleJobIds }, requestId },
      );
    }

    return NextResponse.json(
      {
        batchId: outcome.batchId,
        queuedCount: outcome.queuedJobIds.length,
        queuedJobIds: outcome.queuedJobIds,
        alreadyQueuedJobIds: outcome.alreadyQueuedJobIds,
        ineligibleJobIds: outcome.ineligibleJobIds,
      },
      { status: 202 },
    );
  });
}
