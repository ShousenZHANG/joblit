import { NextResponse } from "next/server";
import { errorJson } from "@/lib/server/api/errorResponse";
import { withExtensionRoute } from "@/lib/server/extensionIngress/withExtensionRoute";
import { prisma } from "@/lib/server/prisma";
import { canonicalizeJobUrl } from "@/lib/shared/canonicalizeJobUrl";

export const runtime = "nodejs";

/**
 * GET /api/ext/jobs/match?url=<jobUrl>
 * Match a job URL to an existing Job record for the authenticated user.
 */
export async function GET(req: Request) {
  return withExtensionRoute(req, "jobs.match", async ({ userId, requestId }) => {
    const url = new URL(req.url);
    const jobUrl = canonicalizeJobUrl(url.searchParams.get("url") ?? "");

    if (!jobUrl || jobUrl.length > 2000) {
      return errorJson(
        "MISSING_PARAM",
        "Missing or invalid 'url' parameter",
        400,
        { requestId },
      );
    }

    const job = await prisma.job.findFirst({
      where: { userId, jobUrl },
      select: {
        id: true,
        title: true,
        company: true,
        status: true,
        jobUrl: true,
      },
    });

    if (!job) {
      return NextResponse.json({ data: null });
    }

    return NextResponse.json({ data: job });
  });
}
