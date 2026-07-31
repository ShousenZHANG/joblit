import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { errorJson, validationError } from "@/lib/server/api/errorResponse";
import { withAgentRoute } from "@/lib/server/api/routeHandler";
import {
  ApplicationPromptError,
  buildApplicationPromptForUser,
} from "@/lib/server/applications/applicationPrompt";
import { issuePromptTailoringRun } from "@/lib/server/tailoringRuns/issuePromptTailoringRun";
import { TailoringRunError } from "@/lib/server/tailoringRuns/tailoringRunProtocol";
import { AgentApplicationPromptRequestSchema } from "@/lib/shared/agentExecutionContract";

export const runtime = "nodejs";

export async function POST(req: Request) {
  return withAgentRoute(req, "tailoring:execute", async ({
    userId,
    requestId,
    authKind,
  }) => {
    const json = await req.json().catch(() => null);
    const parsed = AgentApplicationPromptRequestSchema.safeParse(json);
    if (!parsed.success) {
      return validationError(parsed.error, requestId);
    }
    if (authKind === "agent" && parsed.data.source !== "codex_batch") {
      return errorJson(
        "AGENT_PROTOCOL_REQUIRED",
        "Agent credentials must use the versioned Codex Batch protocol.",
        403,
        { requestId },
      );
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
