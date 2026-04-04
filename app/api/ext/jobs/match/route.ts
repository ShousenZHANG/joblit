import { NextResponse } from "next/server";
import { requireExtensionToken, ExtensionTokenError } from "@/lib/server/auth/requireExtensionToken";
import { unauthorizedError, errorJson } from "@/lib/server/api/errorResponse";
import { prisma } from "@/lib/server/prisma";

export const runtime = "nodejs";

/**
 * GET /api/ext/jobs/match?url=<jobUrl>
 * Match a job URL to an existing Job record for the authenticated user.
 */
export async function GET(req: Request) {
  try {
    const { userId } = await requireExtensionToken(req);
    const url = new URL(req.url);
    const jobUrl = url.searchParams.get("url");

    if (!jobUrl || jobUrl.length > 2000) {
      return errorJson("MISSING_PARAM", "Missing or invalid 'url' parameter", 400);
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
  } catch (err) {
    if (err instanceof ExtensionTokenError) return unauthorizedError();
    throw err;
  }
}
