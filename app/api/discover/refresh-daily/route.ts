import { NextResponse } from "next/server";
import { errorJson } from "@/lib/server/api/errorResponse";
import { constantTimeEqual } from "@/lib/server/auth/constantTimeEqual";
import {
  claimDailyDiscoverRefresh,
  completeDailyDiscoverRefresh,
} from "@/lib/server/discover/discoverCache";
import { executeDiscoverRefresh } from "@/lib/server/discover/refreshDiscover";
import { reportError } from "@/lib/server/observability/errorReporter";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const REFRESH_RUNTIME_MS = 48_000;
// Longer than the platform's 60-second execution ceiling. A duplicate
// delivery cannot reclaim a still-valid invocation during slow DB cleanup.
const REFRESH_LEASE_MS = 90_000;
const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return constantTimeEqual(
    request.headers.get("authorization"),
    `Bearer ${secret}`,
  );
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return errorJson("UNAUTHORIZED", "Unauthorized", 401, { headers: NO_STORE_HEADERS });
  }

  const startedAt = new Date();
  try {
    const claim = await claimDailyDiscoverRefresh(
      startedAt,
      REFRESH_LEASE_MS,
    );
    if (!claim.claimed) {
      return NextResponse.json(
        {
          deduplicated: true,
          runKey: claim.runKey,
          previous: claim.previous,
        },
        { headers: NO_STORE_HEADERS },
      );
    }

    const summary = await executeDiscoverRefresh({
      apiKey: process.env.YOUTUBE_API_KEY,
      maxRuntimeMs: REFRESH_RUNTIME_MS,
    });
    const completed = await completeDailyDiscoverRefresh(
      claim.runKey,
      claim.ownerToken,
      summary,
      new Date(),
    );
    if (!completed) {
      return errorJson("DISCOVER_REFRESH_LEASE_LOST", "Another worker holds the refresh lease", 409, {
        headers: NO_STORE_HEADERS,
      });
    }
    return NextResponse.json(
      { runKey: claim.runKey, ...summary },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    reportError(error, { scope: "discover.refresh-daily" });
    return errorJson("DISCOVER_REFRESH_FAILED", "Discover refresh failed", 500, {
      headers: NO_STORE_HEADERS,
    });
  }
}
