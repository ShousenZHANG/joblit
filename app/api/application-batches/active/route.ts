import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/prisma";
import { withSessionRoute } from "@/lib/server/api/routeHandler";

export const runtime = "nodejs";

const ACTIVE_BATCH_STATUSES = ["QUEUED", "RUNNING"] as const;

export async function GET() {
  return withSessionRoute(async ({ userId }) => {
    const batch = await prisma.applicationBatch.findFirst({
      where: {
        userId,
        status: {
          in: [...ACTIVE_BATCH_STATUSES],
        },
      },
      orderBy: [{ updatedAt: "desc" }],
      select: {
        id: true,
        status: true,
        updatedAt: true,
      },
    });

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
