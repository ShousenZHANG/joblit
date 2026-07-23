import { NextResponse } from "next/server";
import { requireExtensionToken, ExtensionTokenError } from "@/lib/server/auth/requireExtensionToken";
import { unauthorizedError, errorJson } from "@/lib/server/api/errorResponse";
import { checkRateLimit, rateLimitKeyFromRequest, rateLimitHeaders } from "@/lib/server/api/rateLimit";
import { prisma } from "@/lib/server/prisma";
import { canonicalizeJobUrl } from "@/lib/shared/canonicalizeJobUrl";

export const runtime = "nodejs";

/**
 * GET /api/ext/jobs/match?url=<jobUrl>
 * Match a job URL to an existing Job record for the authenticated user.
 */
export async function GET(req: Request) {
  const rl = checkRateLimit(rateLimitKeyFromRequest(req, "ext:jobs:match"), { limit: 60, windowSeconds: 60 });
  if (!rl.allowed) return errorJson("RATE_LIMITED", "Too many requests", 429, { headers: rateLimitHeaders(rl) });

  try {
    const { userId } = await requireExtensionToken(req);
    const url = new URL(req.url);
    const jobUrl = canonicalizeJobUrl(url.searchParams.get("url") ?? "");

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
