import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJsonBody, withSessionRoute } from "@/lib/server/api/routeHandler";
import {
  deleteFieldMappingRule,
  listFieldMappingRules,
  updateFieldMappingRule,
} from "@/lib/server/extensionSubmission";

export const runtime = "nodejs";

const UpdateSchema = z.object({
  id: z.string().uuid(),
  profilePath: z.string().min(1).max(200).optional(),
  staticValue: z.string().max(1000).nullable().optional(),
});

const DeleteSchema = z.object({
  id: z.string().uuid(),
});

export async function GET() {
  return withSessionRoute(async ({ userId }) => {
    const rules = await listFieldMappingRules({ userId });
    return NextResponse.json({ data: rules });
  });
}

export async function PATCH(req: Request) {
  return withSessionRoute(async ({ userId, requestId }) => {
    const parsed = await parseJsonBody(req, UpdateSchema, requestId);
    if (!parsed.ok) return parsed.response;
    const { id, ...data } = parsed.data;
    await updateFieldMappingRule(userId, id, data);
    return NextResponse.json({ success: true });
  });
}

export async function DELETE(req: Request) {
  return withSessionRoute(async ({ userId, requestId }) => {
    const parsed = await parseJsonBody(req, DeleteSchema, requestId);
    if (!parsed.ok) return parsed.response;
    await deleteFieldMappingRule(userId, parsed.data.id);
    return NextResponse.json({ success: true });
  });
}
