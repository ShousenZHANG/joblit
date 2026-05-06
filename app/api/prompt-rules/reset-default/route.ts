import { NextResponse } from "next/server";
import { withSessionRoute } from "@/lib/server/api/routeHandler";
import { resetPromptRulesToDefault } from "@/lib/server/promptRuleTemplates";

export const runtime = "nodejs";

export async function POST() {
  return withSessionRoute(async ({ userId, requestId }) => {
    const created = await resetPromptRulesToDefault(userId);
    return NextResponse.json({
      requestId,
      template: {
        id: created.id,
        name: created.name,
        version: created.version,
        isActive: created.isActive,
      },
    });
  });
}
