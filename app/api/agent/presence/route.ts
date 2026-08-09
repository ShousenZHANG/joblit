import { NextResponse } from "next/server";

import { withSessionRoute } from "@/lib/server/api/routeHandler";
import { prisma } from "@/lib/server/prisma";

export const runtime = "nodejs";

const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
} as const;

export const RUNNER_ONLINE_WINDOW_MS = 90_000;

/**
 * Runner presence, inferred from credential activity.
 *
 * Authenticated Runner calls refresh `AgentCredential.lastUsedAt` behind a
 * 15-second write throttle. A 90-second online window also covers the Runner's
 * 60-second Fit heartbeat plus network and event-loop jitter. Startup remains
 * fast because offline clients recheck every five seconds. Revoked and expired
 * credentials are history, not presence.
 */
export async function GET() {
  return withSessionRoute(async ({ userId }) => {
    const newest = await prisma.agentCredential.findFirst({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        // PostgreSQL sorts NULL first for DESC. Excluding never-used tokens
        // prevents a newly created credential from hiding an active Runner.
        lastUsedAt: { not: null },
      },
      orderBy: { lastUsedAt: "desc" },
      select: { lastUsedAt: true },
    });

    const checkedAt = new Date();
    const lastUsedAt = newest?.lastUsedAt ?? null;
    const status =
      lastUsedAt &&
      checkedAt.getTime() - lastUsedAt.getTime() <= RUNNER_ONLINE_WINDOW_MS
        ? "online"
        : "offline";

    return NextResponse.json(
      {
        status,
        lastUsedAt: lastUsedAt?.toISOString() ?? null,
        checkedAt: checkedAt.toISOString(),
        onlineWindowMs: RUNNER_ONLINE_WINDOW_MS,
      },
      { headers: PRIVATE_NO_STORE_HEADERS },
    );
  });
}
