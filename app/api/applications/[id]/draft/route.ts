import { NextResponse } from "next/server";
import { z } from "zod";
import { withSessionRoute, parseJsonBody } from "@/lib/server/api/routeHandler";
import {
  autoSaveApplicationEdit,
  type AutoSaveApplicationEditResult,
} from "@/lib/server/applications/applicationEdit";
import { UuidParamSchema } from "@/lib/shared/schemas/common";
import { aiContentSchema } from "@/lib/shared/schemas/aiContent";

export const runtime = "nodejs";

const BodySchema = z.object({
  aiContent: aiContentSchema,
  /** Hash from the client's last-known load. `null` on first save. */
  expectedHash: z.string().nullable(),
});

function applicationDraftResponse(
  result: AutoSaveApplicationEditResult,
  requestId: string,
) {
  if (result.kind === "committed") {
    return NextResponse.json({
      status: result.publication.status,
      publication: result.publication,
      aiContent: result.aiContent,
      aiContentHash: result.aiContentHash,
      requestId,
    });
  }
  if (result.kind === "not_found") {
    return NextResponse.json(
      {
        error: { code: "NOT_FOUND", message: "Application not found" },
        requestId,
      },
      { status: 404 },
    );
  }
  if (result.kind === "stale_write") {
    return NextResponse.json(
      {
        error: {
          code: "STALE_WRITE",
          message: "Another tab updated this draft",
        },
        ...("currentHash" in result
          ? { currentHash: result.currentHash }
          : {}),
        requestId,
      },
      { status: 409 },
    );
  }
  if (result.kind === "invalid_ai_content") {
    return NextResponse.json(
      {
        error: {
          code: "AI_CONTENT_INVALID",
          message: "Stored aiContent failed schema validation",
        },
        requestId,
      },
      { status: 500 },
    );
  }
  return NextResponse.json(
    {
      error: {
        code: "STALE_RENDER_CONTEXT",
        message:
          "Your resume profile or job changed while this draft was saving. Try again.",
      },
      requestId,
    },
    { status: 409 },
  );
}

/** Auto-save browser decisions through the Application Edit module. */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return withSessionRoute(
    async ({ userId, requestId, params }) => {
      const parsedBody = await parseJsonBody(req, BodySchema, requestId);
      if (!parsedBody.ok) return parsedBody.response;
      const result = await autoSaveApplicationEdit({
        userId,
        applicationId: params.id,
        expectedHash: parsedBody.data.expectedHash,
        submittedAiContent: parsedBody.data.aiContent,
      });
      return applicationDraftResponse(result, requestId);
    },
    { params: ctx.params, schema: UuidParamSchema },
  );
}
