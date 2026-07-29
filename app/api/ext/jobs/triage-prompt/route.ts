import { NextResponse } from "next/server";

import { errorJson, validationError } from "@/lib/server/api/errorResponse";
import {
  ApplicationPromptError,
  buildTriagePromptForUser,
  TriagePromptRequestSchema,
} from "@/lib/server/applications/applicationPrompt";
import { withExtensionRoute } from "@/lib/server/extensionIngress/withExtensionRoute";

export const runtime = "nodejs";

export async function POST(req: Request) {
  return withExtensionRoute(
    req,
    "jobs.triagePrompt",
    async ({ userId, requestId }) => {
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
    },
  );
}
