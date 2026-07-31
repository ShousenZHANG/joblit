import { NextResponse } from "next/server";

import { withSessionRoute } from "@/lib/server/api/routeHandler";
import { cancelFitRun } from "@/lib/server/jobs/fitRunService";

export const runtime = "nodejs";

const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
} as const;

/** Cancel all pending and claimed Fit work owned by the signed-in user. */
export async function POST() {
  return withSessionRoute(async ({ userId }) => {
    const result = await cancelFitRun(userId);
    return NextResponse.json(result, { headers: PRIVATE_NO_STORE_HEADERS });
  });
}
