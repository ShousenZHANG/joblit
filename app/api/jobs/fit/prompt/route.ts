import { NextResponse } from "next/server";

import { errorJson, validationError } from "@/lib/server/api/errorResponse";
import { withAgentRoute } from "@/lib/server/api/routeHandler";
import {
  ApplicationPromptError,
  buildTriagePromptForUser,
  TriagePromptRequestSchema,
} from "@/lib/server/applications/applicationPrompt";
import {
  bindFitBatchPrompt,
  FitBatchClaimError,
} from "@/lib/server/jobs/fitRunService";

export const runtime = "nodejs";

/**
 * Coarse-triage prompt for one leased fit batch.
 *
 * Lives on the Agent seam so the Runner can request it with a capability-
 * scoped credential; the browser can still reach it with a session cookie.
 */
export async function POST(req: Request) {
  return withAgentRoute(req, "fit:drain", async ({ userId, requestId }) => {
    const json = await req.json().catch(() => null);
    const parsed = TriagePromptRequestSchema.safeParse(json);
    if (!parsed.success) {
      return validationError(parsed.error, requestId);
    }

    try {
      const payload = await buildTriagePromptForUser({
        userId,
        jobIds: parsed.data.jobIds,
      });
      return NextResponse.json(
        await bindFitBatchPrompt(userId, parsed.data.jobIds, payload, {
          claimId: parsed.data.claimId,
          attemptId: parsed.data.attemptId ?? parsed.data.claimToken,
        }),
      );
    } catch (error) {
      if (error instanceof FitBatchClaimError) {
        return errorJson(error.code, error.message, error.status, {
          requestId,
        });
      }
      if (error instanceof ApplicationPromptError) {
        return errorJson(
          error.code === "INVALID_REQUEST" ? "INVALID_BODY" : error.code,
          error.message,
          error.status,
          { details: error.details, requestId },
        );
      }
      throw error;
    }
  });
}
