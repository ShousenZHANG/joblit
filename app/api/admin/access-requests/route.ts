import { NextResponse } from "next/server";
import { withEmailSessionRoute } from "@/lib/server/api/routeHandler";
import { isAdminEmail } from "@/lib/server/auth/adminAccess";
import { listAccessRequests } from "@/lib/server/access/accessRequestService";

export const runtime = "nodejs";

export async function GET() {
  return withEmailSessionRoute(async ({ userEmail }) => {
    if (!isAdminEmail(userEmail)) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }
    const requests = await listAccessRequests();
    return NextResponse.json({
      requests: requests.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        reviewedAt: r.reviewedAt?.toISOString() ?? null,
      })),
    });
  });
}
