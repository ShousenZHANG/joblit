import { NextResponse } from "next/server";
import { z } from "zod";

import { errorJson, validationError } from "@/lib/server/api/errorResponse";
import {
  ApplicationPromptError,
  ApplicationPromptRequestSchema,
  buildApplicationPromptForUser,
} from "@/lib/server/applications/applicationPrompt";
import { withExtensionRoute } from "@/lib/server/extensionIngress/withExtensionRoute";
import { issuePromptTailoringRun } from "@/lib/server/tailoringRuns/issuePromptTailoringRun";
import { TailoringRunError } from "@/lib/server/tailoringRuns/tailoringRunProtocol";

export const runtime = "nodejs";

const ExtensionPromptRequestSchema = ApplicationPromptRequestSchema.extend({
  // Optional during the additive v1 rollout. Extension builds predating the
  // TailoringRun contract send only { jobId, target }; they keep receiving the
  // legacy prompt envelope and remain import-compatible until they upgrade.
  issueKey: z.string().uuid().optional(),
});

export async function POST(req: Request) {
  return withExtensionRoute(
    req,
    "applications.prompt",
    async ({ userId, requestId }) => {
      const json = await req.json().catch(() => null);
      const parsed = ExtensionPromptRequestSchema.safeParse(json);
      if (!parsed.success) {
        return validationError(parsed.error, requestId);
      }

      try {
        const payload = await buildApplicationPromptForUser({
          userId,
          jobId: parsed.data.jobId,
          target: parsed.data.target,
          // The extension drives a local Hermes run; reasoning models stall on
          // the full prompt, so serve the lean variant here.
          variant: "lean",
        });
        const tailoringRun =
          parsed.data.target === "match" || !parsed.data.issueKey
            ? null
            : await issuePromptTailoringRun({
                userId,
                jobId: parsed.data.jobId,
                target: parsed.data.target,
                source: "LOCAL_AI",
                delivery: "DRAFT",
                issueKey: parsed.data.issueKey,
                payload,
              });
        return NextResponse.json({
          ...payload,
          ...(tailoringRun ? { tailoringRun } : {}),
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
        if (error instanceof TailoringRunError) {
          return errorJson(error.code, error.message, error.status, {
            requestId,
          });
        }
        throw error;
      }
    },
  );
}
