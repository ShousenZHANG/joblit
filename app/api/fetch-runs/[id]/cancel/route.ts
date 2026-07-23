import { NextResponse } from "next/server";
import { withSessionRoute } from "@/lib/server/api/routeHandler";
import { UuidParamSchema } from "@/lib/shared/schemas/common";
import { prisma } from "@/lib/server/prisma";
import { acquireFetchRunLifecycleLock } from "@/lib/server/fetchRuns/fetchRunLifecycleLock";

export const runtime = "nodejs";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withSessionRoute(
    async ({ userId, params }) => {
      const result = await prisma.$transaction(
        async (tx) => {
          await acquireFetchRunLifecycleLock(tx, params.id);
          const run = await tx.fetchRun.findFirst({
            where: { id: params.id, userId },
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
    },
    { params: ctx.params, schema: UuidParamSchema },
  );
}
