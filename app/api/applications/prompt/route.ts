import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { errorJson, validationError } from "@/lib/server/api/errorResponse";
import { withSessionRoute } from "@/lib/server/api/routeHandler";
import {
  ApplicationPromptError,
  ApplicationPromptRequestSchema,
  buildApplicationPromptForUser,
} from "@/lib/server/applications/applicationPrompt";
import { issuePromptTailoringRun } from "@/lib/server/tailoringRuns/issuePromptTailoringRun";
import { TailoringRunError } from "@/lib/server/tailoringRuns/tailoringRunProtocol";
import { TailoringRunPromptSourceSchema } from "@/lib/shared/tailoringRunContract";

export const runtime = "nodejs";

const PromptRequestSchema = ApplicationPromptRequestSchema.extend({
  source: TailoringRunPromptSourceSchema.optional().default("manual_import"),
  delivery: z.enum(["DRAFT", "FINAL"]).optional().default("DRAFT"),
  issueKey: z.string().uuid().optional(),
  batchId: z.string().uuid().optional(),
  batchTaskId: z.string().uuid().optional(),
  batchAttemptId: z.string().uuid().optional(),
}).superRefine((value, ctx) => {
  if (value.source !== "codex_batch") return;
  if (value.delivery !== "FINAL") {
    ctx.addIssue({
      code: "custom",
      path: ["delivery"],
      message: "Codex Batch delivery must be FINAL",
    });
  }
  for (const field of ["issueKey", "batchId", "batchTaskId", "batchAttemptId"] as const) {
    if (!value[field]) {
      ctx.addIssue({
        code: "custom",
        path: [field],
        message: `${field} is required for Codex Batch`,
      });
    }
  }
});

export async function POST(req: Request) {
  return withSessionRoute(async ({ userId, requestId }) => {
    const json = await req.json().catch(() => null);
    const parsed = PromptRequestSchema.safeParse(json);
    if (!parsed.success) {
      return validationError(parsed.error, requestId);
    }

    try {
      const payload = await buildApplicationPromptForUser({
        userId,
        jobId: parsed.data.jobId,
        target: parsed.data.target,
      });
      const tailoringRun =
        parsed.data.target === "match"
          ? null
          : await issuePromptTailoringRun({
              userId,
              jobId: parsed.data.jobId,
              target: parsed.data.target,
              source:
                parsed.data.source === "codex_batch"
                  ? "CODEX_BATCH"
                  : "MANUAL_IMPORT",
              delivery: parsed.data.delivery,
              issueKey: parsed.data.issueKey ?? randomUUID(),
              payload,
              ...(parsed.data.source === "codex_batch"
                ? {
                    batch: {
                      batchId: parsed.data.batchId!,
                      taskId: parsed.data.batchTaskId!,
                      executionAttemptId: parsed.data.batchAttemptId!,
                    },
                  }
                : {}),
            });
      return NextResponse.json({
        ...payload,
        requestId,
        ...(tailoringRun ? { tailoringRun } : {}),
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
      if (error instanceof TailoringRunError) {
        return errorJson(error.code, error.message, error.status, { requestId });
      }
      throw error;
    }
  });
}
