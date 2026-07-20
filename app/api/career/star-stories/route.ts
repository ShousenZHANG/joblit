import { NextResponse } from "next/server";
import { z } from "zod";
import { withSessionRoute, parseJsonBody } from "@/lib/server/api/routeHandler";
import { careerRateLimit } from "@/lib/server/career/api";
import { careerErrorResponse } from "@/lib/server/career/errors";
import {
  createStarStory,
  deleteStarStory,
  listStarStories,
  updateStarStory,
} from "@/lib/server/career/records";
import {
  StarStoryCreateSchema,
  StarStoryPatchSchema,
} from "@/lib/server/career/schemas";

export const runtime = "nodejs";

const DeleteQuerySchema = z.object({ id: z.string().uuid() }).strict();

export function GET() {
  return withSessionRoute(async ({ userId, requestId }) => {
    const rateLimit = careerRateLimit(userId, "star-stories:get");
    if (!rateLimit.ok) return rateLimit.response;
    const data = await listStarStories(userId);
    return NextResponse.json({ data, requestId }, { headers: rateLimit.headers });
  });
}

export function POST(req: Request) {
  return withSessionRoute(async ({ userId, requestId }) => {
    const rateLimit = careerRateLimit(userId, "star-stories:post", {
      limit: 20,
      windowSeconds: 60,
    });
    if (!rateLimit.ok) return rateLimit.response;
    const body = await parseJsonBody(req, StarStoryCreateSchema, requestId);
    if (!body.ok) return body.response;
    try {
      const result = await createStarStory(userId, body.data);
      return NextResponse.json(
        { data: result.story, reused: result.reused, requestId },
        { status: result.reused ? 200 : 201, headers: rateLimit.headers },
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
    const rateLimit = careerRateLimit(userId, "star-stories:patch", {
      limit: 30,
      windowSeconds: 60,
    });
    if (!rateLimit.ok) return rateLimit.response;
    const body = await parseJsonBody(req, StarStoryPatchSchema, requestId);
    if (!body.ok) return body.response;
    const { id, ...patch } = body.data;
    try {
      const data = await updateStarStory(userId, id, patch);
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
    const rateLimit = careerRateLimit(userId, "star-stories:delete", {
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
      await deleteStarStory(userId, query.data.id);
      return NextResponse.json({ data: { deleted: true }, requestId }, { headers: rateLimit.headers });
    } catch (error) {
      const response = careerErrorResponse(error, requestId);
      if (response) return response;
      throw error;
    }
  });
}
