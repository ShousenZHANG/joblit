import { NextResponse } from "next/server";
import { z } from "zod";
import { withSessionRoute, parseJsonBody } from "@/lib/server/api/routeHandler";
import {
  discardApplicationEdits,
  type DiscardApplicationEditsResult,
} from "@/lib/server/applications/applicationEdit";
import { UuidParamSchema } from "@/lib/shared/schemas/common";

export const runtime = "nodejs";

const BodySchema = z.object({ expectedHash: z.string().nullable() });

function applicationDiscardResponse(
  result: DiscardApplicationEditsResult,
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
  if (result.kind === "no_ai_content") {
    return NextResponse.json(
      {
        error: { code: "NO_AI_CONTENT", message: "No AI content to discard" },
        requestId,
      },
      { status: 400 },
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
          "Your resume profile or job changed while edits were being discarded. Try again.",
      },
      requestId,
    },
    { status: 409 },
  );
}

/** Reset browser decisions through the Application Edit module. */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return withSessionRoute(
    async ({ userId, requestId, params }) => {
      const parsedBody = await parseJsonBody(req, BodySchema, requestId);
      if (!parsedBody.ok) return parsedBody.response;
      const result = await discardApplicationEdits({
        userId,
        applicationId: params.id,
        expectedHash: parsedBody.data.expectedHash,
      });
      return applicationDiscardResponse(result, requestId);
    },
    { params: ctx.params, schema: UuidParamSchema },
  );
}
