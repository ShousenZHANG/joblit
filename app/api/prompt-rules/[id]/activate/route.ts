import { NextResponse } from "next/server";
import { withSessionRoute } from "@/lib/server/api/routeHandler";
import { z } from "zod";
import { activatePromptRuleTemplate } from "@/lib/server/promptRuleTemplates";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  return withSessionRoute(async ({ userId, requestId }) => {
    const { id } = await context.params;
    if (!z.string().uuid().safeParse(id).success) {
      return NextResponse.json(
        { error: { code: "INVALID_PARAMS", message: "Invalid template id" }, requestId },
        { status: 400 },
      );
    }
    const activated = await activatePromptRuleTemplate(userId, id);
    if (!activated) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Template not found" }, requestId },
        { status: 404 },
      );
    }

    return NextResponse.json({
      requestId,
      template: {
        id: activated.id,
        name: activated.name,
        version: activated.version,
        isActive: activated.isActive,
      },
    });
  });
}

