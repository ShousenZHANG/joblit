import { NextResponse } from "next/server";
import { z } from "zod";
import type { EvidenceKind } from "@/lib/generated/prisma";
import { withSessionRoute, parseJsonBody } from "@/lib/server/api/routeHandler";
import { careerRateLimit } from "@/lib/server/career/api";
import { careerErrorResponse } from "@/lib/server/career/errors";
import {
  createEvidenceSnapshot,
  listEvidence,
} from "@/lib/server/career/evidence";
import { EvidenceCreateSchema } from "@/lib/server/career/schemas";

export const runtime = "nodejs";

const QuerySchema = z
  .object({
    applicationId: z.string().uuid().optional(),
    jobId: z.string().uuid().optional(),
    kind: z
      .enum([
        "RESUME_PROFILE",
        "JOB_DESCRIPTION",
        "APPLICATION_DRAFT",
        "USER_CLAIM",
        "STAR_STORY",
        "INTERVIEW_NOTE",
        "OFFER",
      ])
      .optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

export function GET(req: Request) {
  return withSessionRoute(async ({ userId, requestId }) => {
    const rateLimit = careerRateLimit(userId, "evidence:get");
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
    const data = await listEvidence(userId, {
      ...query.data,
      kind: query.data.kind as EvidenceKind | undefined,
    });
    return NextResponse.json({ data, requestId }, { headers: rateLimit.headers });
  });
}

export function POST(req: Request) {
  return withSessionRoute(async ({ userId, requestId }) => {
    const rateLimit = careerRateLimit(userId, "evidence:post", {
      limit: 30,
      windowSeconds: 60,
    });
    if (!rateLimit.ok) return rateLimit.response;
    const body = await parseJsonBody(req, EvidenceCreateSchema, requestId);
    if (!body.ok) return body.response;
    try {
      const data = await createEvidenceSnapshot(userId, body.data);
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
