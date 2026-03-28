import { NextResponse } from "next/server";
import { requireSession, UnauthorizedError } from "@/lib/server/auth/requireSession";
import type { SessionContext } from "@/lib/server/auth/requireSession";
import { unauthorizedError } from "@/lib/server/api/errorResponse";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";

export const runtime = "nodejs";

const ParamsSchema = z.object({ id: z.string().uuid() });

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  let session: SessionContext;
  try {
    session = await requireSession();
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedError();
    throw err;
  }
  const { userId } = session;

  const params = await ctx.params;
  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) return NextResponse.json({ error: "INVALID_PARAMS" }, { status: 400 });

  const run = await prisma.fetchRun.findFirst({
    where: { id: parsed.data.id, userId },
    select: { id: true, status: true },
  });
  if (!run) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (run.status === "SUCCEEDED" || run.status === "FAILED") {
    return NextResponse.json({ error: "ALREADY_FINISHED", status: run.status }, { status: 409 });
  }

  await prisma.fetchRun.update({
    where: { id: run.id },
    data: { status: "FAILED", error: "Cancelled by user" },
  });

  return NextResponse.json({ ok: true });
}
