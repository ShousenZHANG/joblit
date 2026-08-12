import { NextResponse } from "next/server";

import { errorJson, validationError } from "@/lib/server/api/errorResponse";
import { withSessionRoute } from "@/lib/server/api/routeHandler";
import {
  ApplicationPromptError,
  buildApplicationPromptForUser,
} from "@/lib/server/applications/applicationPrompt";
import { ManualPromptRequestSchema } from "@/lib/shared/agentExecutionContract";

export const runtime = "nodejs";

/**
 * Issue the prompt for one target so the user can paste it into a chatbot.
 *
 * This used to mint a TailoringRun on every call, including for the browser's
 * own copy/paste flow — which then dragged a manual import through a receipt
 * probe and an acceptance commit it never needed. The run existed to fence an
 * unattended worker's retries against each other; a person pressing Copy has
 * no retries to fence. Issuing a prompt is a pure read again.
 */
export async function POST(req: Request) {
  return withSessionRoute(async ({ userId, requestId }) => {
    const json = await req.json().catch(() => null);
    const parsed = ManualPromptRequestSchema.safeParse(json);
    if (!parsed.success) {
      return validationError(parsed.error, requestId);
    }

    try {
      const payload = await buildApplicationPromptForUser({
        userId,
        jobId: parsed.data.jobId,
        target: parsed.data.target,
      });
      return NextResponse.json({
        ...payload,
        requestId,
        prompt: {
          ...payload.prompt,
          systemPrompt: payload.prompt.instructions,
          userPrompt: payload.prompt.input,
          shortUserPrompt: "",
        },
      });
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
