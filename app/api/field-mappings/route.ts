import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth";
import {
  listFieldMappingRules,
  deleteFieldMappingRule,
  updateFieldMappingRule,
} from "@/lib/server/extensionSubmission";
import { z } from "zod";

export const runtime = "nodejs";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rules = await listFieldMappingRules({ userId: session.user.id });
  return NextResponse.json({ data: rules });
}

const UpdateSchema = z.object({
  id: z.string().uuid(),
  profilePath: z.string().min(1).max(200).optional(),
  staticValue: z.string().max(1000).nullable().optional(),
});

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { id, ...data } = parsed.data;
  await updateFieldMappingRule(session.user.id, id, data);
  return NextResponse.json({ success: true });
}

const DeleteSchema = z.object({
  id: z.string().uuid(),
});

export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = DeleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  await deleteFieldMappingRule(session.user.id, parsed.data.id);
  return NextResponse.json({ success: true });
}
