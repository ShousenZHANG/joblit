import { NextResponse } from "next/server";
import { z } from "zod";
import { withEmailSessionRoute, parseJsonBody } from "@/lib/server/api/routeHandler";
import { isAdminEmail } from "@/lib/server/auth/adminAccess";
import { reviewAccessRequest } from "@/lib/server/access/accessRequestService";

export const runtime = "nodejs";

const ParamsSchema = z.object({ id: z.string().uuid() });
const BodySchema = z.object({ action: z.enum(["approve", "reject"]) });

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withEmailSessionRoute(async ({ userEmail }) => {
    if (!isAdminEmail(userEmail)) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }
    const params = ParamsSchema.safeParse(await ctx.params);
    if (!params.success) {
      return NextResponse.json({ error: "INVALID_PARAMS" }, { status: 400 });
    }
    const parsed = await parseJsonBody(req, BodySchema);
    if (!parsed.ok) return parsed.response;

    const status = parsed.data.action === "approve" ? "APPROVED" : "REJECTED";
    const updated = await reviewAccessRequest(params.data.id, status, userEmail);
    return NextResponse.json({ ok: true, request: updated });
  });
}
