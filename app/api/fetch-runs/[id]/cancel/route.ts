import { NextResponse } from "next/server";
import { requireSession, UnauthorizedError } from "@/lib/server/auth/requireSession";
import type { SessionContext } from "@/lib/server/auth/requireSession";
import { unauthorizedError } from "@/lib/server/api/errorResponse";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { acquireFetchRunLifecycleLock } from "@/lib/server/fetchRuns/fetchRunLifecycleLock";

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

  const result = await prisma.$transaction(
    async (tx) => {
      await acquireFetchRunLifecycleLock(tx, parsed.data.id);
      const run = await tx.fetchRun.findFirst({
        where: { id: parsed.data.id, userId },
        select: { id: true, status: true },
      });
      if (!run) return { kind: "not_found" as const };
      if (run.status === "SUCCEEDED" || run.status === "FAILED") {
        return { kind: "finished" as const, status: run.status };
      }

      const cancelled = await tx.fetchRun.updateMany({
        where: {
          id: run.id,
          userId,
          status: { in: ["QUEUED", "RUNNING"] },
        },
        data: { status: "FAILED", error: "Cancelled by user" },
      });
      if (cancelled.count === 0) {
        const current = await tx.fetchRun.findFirst({
          where: { id: run.id, userId },
          select: { status: true },
        });
        return {
          kind: "finished" as const,
          status: current?.status ?? "FAILED",
        };
      }
      return { kind: "cancelled" as const };
    },
    { timeout: 30_000 },
  );

  if (result.kind === "not_found") {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  if (result.kind === "finished") {
    return NextResponse.json(
      { error: "ALREADY_FINISHED", status: result.status },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true });
}
