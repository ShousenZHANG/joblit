import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/prisma";
import { withSessionRoute } from "@/lib/server/api/routeHandler";

export const runtime = "nodejs";

/**
 * The batch the Jobs page should be watching.
 *
 * An active batch wins over a merely newer one. Ordering by `updatedAt` alone
 * looked equivalent while a live batch was always the most recently touched
 * row, but it is not: a Runner replaying a receipt against a batch that has
 * already terminalized bumps that batch's `updatedAt` after a newer batch was
 * queued. This read would then hand the browser the finished batch, the live
 * one would never be adopted, and the user would watch a page that showed no
 * progress for work that was actually running. That is the exact failure this
 * whole surface exists to make impossible.
 *
 * The fallback still returns the most recent batch, so a page loaded after
 * everything settled can still resolve the last run.
 */
export async function GET() {
  return withSessionRoute(async ({ userId }) => {
    const select = {
      id: true,
      status: true,
      updatedAt: true,
    } as const;

    const batch =
      (await prisma.applicationBatch.findFirst({
        where: { userId, status: { in: ["QUEUED", "RUNNING"] } },
        orderBy: [{ createdAt: "desc" }],
        select,
      })) ??
      (await prisma.applicationBatch.findFirst({
        where: { userId },
        orderBy: [{ updatedAt: "desc" }],
        select,
      }));

    if (!batch) {
      return NextResponse.json({
        batchId: null,
        status: null,
        updatedAt: null,
      });
    }

    return NextResponse.json({
      batchId: batch.id,
      status: batch.status,
      updatedAt: batch.updatedAt.toISOString(),
    });
  });
}
