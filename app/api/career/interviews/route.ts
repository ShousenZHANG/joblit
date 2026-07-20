import { NextResponse } from "next/server";
import { z } from "zod";
import { withSessionRoute, parseJsonBody } from "@/lib/server/api/routeHandler";
import { careerRateLimit } from "@/lib/server/career/api";
import { careerErrorResponse } from "@/lib/server/career/errors";
import {
  createInterviewPlan,
  deleteInterviewPlan,
  listInterviewPlans,
  updateInterviewPlan,
} from "@/lib/server/career/records";
import {
  InterviewPlanCreateSchema,
  InterviewPlanPatchSchema,
} from "@/lib/server/career/schemas";

export const runtime = "nodejs";

const QuerySchema = z.object({ jobId: z.string().uuid().optional() }).strict();
const DeleteQuerySchema = z.object({ id: z.string().uuid() }).strict();

export function GET(req: Request) {
  return withSessionRoute(async ({ userId, requestId }) => {
    const rateLimit = careerRateLimit(userId, "interviews:get");
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
    const data = await listInterviewPlans(userId, query.data.jobId);
    return NextResponse.json({ data, requestId }, { headers: rateLimit.headers });
  });
}

export function POST(req: Request) {
  return withSessionRoute(async ({ userId, requestId }) => {
    const rateLimit = careerRateLimit(userId, "interviews:post", {
      limit: 20,
      windowSeconds: 60,
    });
    if (!rateLimit.ok) return rateLimit.response;
    const body = await parseJsonBody(req, InterviewPlanCreateSchema, requestId);
    if (!body.ok) return body.response;
    try {
      const data = await createInterviewPlan(userId, body.data);
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

export function PATCH(req: Request) {
  return withSessionRoute(async ({ userId, requestId }) => {
    const rateLimit = careerRateLimit(userId, "interviews:patch", {
      limit: 30,
      windowSeconds: 60,
    });
    if (!rateLimit.ok) return rateLimit.response;
    const body = await parseJsonBody(req, InterviewPlanPatchSchema, requestId);
    if (!body.ok) return body.response;
    const { id, ...patch } = body.data;
    try {
      const data = await updateInterviewPlan(userId, id, patch);
      return NextResponse.json({ data, requestId }, { headers: rateLimit.headers });
    } catch (error) {
      const response = careerErrorResponse(error, requestId);
      if (response) return response;
      throw error;
    }
  });
}

export function DELETE(req: Request) {
  return withSessionRoute(async ({ userId, requestId }) => {
    const rateLimit = careerRateLimit(userId, "interviews:delete", {
      limit: 20,
      windowSeconds: 60,
    });
    if (!rateLimit.ok) return rateLimit.response;
    const query = DeleteQuerySchema.safeParse(
      Object.fromEntries(new URL(req.url).searchParams.entries()),
    );
    if (!query.success) {
      return NextResponse.json(
        { error: { code: "INVALID_QUERY", message: "Invalid query", details: query.error.flatten() }, requestId },
        { status: 400, headers: rateLimit.headers },
      );
    }
    try {
      await deleteInterviewPlan(userId, query.data.id);
      return NextResponse.json({ data: { deleted: true }, requestId }, { headers: rateLimit.headers });
    } catch (error) {
      const response = careerErrorResponse(error, requestId);
      if (response) return response;
      throw error;
    }
  });
}
