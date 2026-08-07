import { NextResponse } from "next/server";

import { withSessionRoute } from "@/lib/server/api/routeHandler";
import { prisma } from "@/lib/server/prisma";

export const runtime = "nodejs";

const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
} as const;

/**
 * Runner presence, inferred from credential activity.
 *
 * Every authenticated Runner call refreshes `AgentCredential.lastUsedAt`
 * behind a five-minute write throttle, so the newest value across the
 * caller's live credentials is a liveness signal with five-minute precision —
 * free, and requiring no Runner changes. Revoked and expired credentials are
 * excluded: their activity is history, not presence.
 */
export async function GET() {
  return withSessionRoute(async ({ userId }) => {
    const newest = await prisma.agentCredential.findFirst({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { lastUsedAt: "desc" },
      select: { lastUsedAt: true },
    });

    return NextResponse.json(
      { lastUsedAt: newest?.lastUsedAt?.toISOString() ?? null },
      { headers: PRIVATE_NO_STORE_HEADERS },
    );
  });
}
