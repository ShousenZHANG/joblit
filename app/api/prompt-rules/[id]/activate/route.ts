import { NextResponse } from "next/server";
import { requireSession, UnauthorizedError } from "@/lib/server/auth/requireSession";
import type { SessionContext } from "@/lib/server/auth/requireSession";
import { unauthorizedError } from "@/lib/server/api/errorResponse";
import { activatePromptRuleTemplate } from "@/lib/server/promptRuleTemplates";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  let ctx: SessionContext;
  try {
    ctx = await requireSession();
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedError();
    throw err;
  }
  const { userId, requestId } = ctx;

  const { id } = await context.params;
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
}

