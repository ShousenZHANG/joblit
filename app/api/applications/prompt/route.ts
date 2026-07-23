import { NextResponse } from "next/server";

import { errorJson, validationError } from "@/lib/server/api/errorResponse";
import { withSessionRoute } from "@/lib/server/api/routeHandler";
import {
  ApplicationPromptError,
  ApplicationPromptRequestSchema,
  buildApplicationPromptForUser,
} from "@/lib/server/applications/applicationPrompt";

export const runtime = "nodejs";

export async function POST(req: Request) {
  return withSessionRoute(async ({ userId, requestId }) => {
    const json = await req.json().catch(() => null);
    const parsed = ApplicationPromptRequestSchema.safeParse(json);
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
