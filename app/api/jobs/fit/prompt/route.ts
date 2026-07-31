import { NextResponse } from "next/server";

import { errorJson, validationError } from "@/lib/server/api/errorResponse";
import { withAgentRoute } from "@/lib/server/api/routeHandler";
import {
  ApplicationPromptError,
  buildTriagePromptForUser,
  TriagePromptRequestSchema,
} from "@/lib/server/applications/applicationPrompt";

export const runtime = "nodejs";

/**
 * Coarse-triage prompt for one leased fit batch.
 *
 * Replaces `/api/ext/jobs/triage-prompt`, which sat behind the extension
 * ingress. On the agent seam so the Runner can request it with its token; the
 * browser can still reach it with a session cookie.
 */
export async function POST(req: Request) {
  return withAgentRoute(req, async ({ userId, requestId }) => {
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
      return NextResponse.json(payload);
    } catch (error) {
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
