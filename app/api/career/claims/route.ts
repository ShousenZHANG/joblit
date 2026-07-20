import { NextResponse } from "next/server";
import { z } from "zod";
import { withSessionRoute, parseJsonBody } from "@/lib/server/api/routeHandler";
import { careerRateLimit } from "@/lib/server/career/api";
import { careerErrorResponse } from "@/lib/server/career/errors";
import {
  attachClaimEvidence,
  listClaimEvidence,
} from "@/lib/server/career/evidence";
import { ClaimEvidenceCreateSchema } from "@/lib/server/career/schemas";

export const runtime = "nodejs";

const QuerySchema = z.object({ applicationId: z.string().uuid() }).strict();

export function GET(req: Request) {
  return withSessionRoute(async ({ userId, requestId }) => {
    const rateLimit = careerRateLimit(userId, "claims:get");
    if (!rateLimit.ok) return rateLimit.response;
    const query = QuerySchema.safeParse(
      Object.fromEntries(new URL(req.url).searchParams.entries()),
    );
    if (!query.success) {
      return NextResponse.json(
        { error: { code: "INVALID_QUERY", message: "Invalid query", details: query.error.flatten() }, requestId },
        { status: 400, headers: rateLimit.headers },
      );
    }
    const data = await listClaimEvidence(userId, query.data.applicationId);
    return NextResponse.json({ data, requestId }, { headers: rateLimit.headers });
  });
}

export function POST(req: Request) {
  return withSessionRoute(async ({ userId, requestId }) => {
    const rateLimit = careerRateLimit(userId, "claims:post", {
      limit: 60,
      windowSeconds: 60,
    });
    if (!rateLimit.ok) return rateLimit.response;
    const body = await parseJsonBody(req, ClaimEvidenceCreateSchema, requestId);
    if (!body.ok) return body.response;
    try {
      const data = await attachClaimEvidence(userId, body.data);
      return NextResponse.json(
        { data, requestId },
        { status: 201, headers: rateLimit.headers },
      );
    } catch (error) {
      const response = careerErrorResponse(error, requestId);
      if (response) return response;
      throw error;
    }
  });
}
