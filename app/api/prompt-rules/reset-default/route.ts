import { NextResponse } from "next/server";
import { requireSession, UnauthorizedError } from "@/lib/server/auth/requireSession";
import type { SessionContext } from "@/lib/server/auth/requireSession";
import { unauthorizedError } from "@/lib/server/api/errorResponse";
import { resetPromptRulesToDefault } from "@/lib/server/promptRuleTemplates";

export const runtime = "nodejs";

export async function POST() {
  let ctx: SessionContext;
  try {
    ctx = await requireSession();
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedError();
    throw err;
  }
  const { userId, requestId } = ctx;

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
}

