import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@/lib/generated/prisma";
import { withSessionRoute, parseJsonBody } from "@/lib/server/api/routeHandler";
import { careerRateLimit } from "@/lib/server/career/api";
import {
  appendApplicationEvent,
  listApplicationEvents,
} from "@/lib/server/career/applicationEvents";
import { careerErrorResponse } from "@/lib/server/career/errors";
import { ApplicationEventCreateSchema } from "@/lib/server/career/schemas";

export const runtime = "nodejs";

const QuerySchema = z
  .object({
    jobId: z.string().uuid().optional(),
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

export function GET(req: Request) {
  return withSessionRoute(async ({ userId, requestId }) => {
    const rateLimit = careerRateLimit(userId, "events:get");
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
    const events = await listApplicationEvents(userId, query.data);
    return NextResponse.json(
      {
        data: events,
        nextCursor: events.length === query.data.limit ? events.at(-1)?.id ?? null : null,
        requestId,
      },
      { headers: rateLimit.headers },
    );
  });
}

export function POST(req: Request) {
  return withSessionRoute(async ({ userId, requestId }) => {
    const rateLimit = careerRateLimit(userId, "events:post", {
      limit: 30,
      windowSeconds: 60,
    });
    if (!rateLimit.ok) return rateLimit.response;
    const body = await parseJsonBody(req, ApplicationEventCreateSchema, requestId);
    if (!body.ok) return body.response;
    try {
      const result = await appendApplicationEvent(userId, {
        ...body.data,
        metadata: body.data.metadata as Prisma.InputJsonValue | undefined,
      });
      return NextResponse.json(
        { data: result.event, replayed: result.replayed, requestId },
        { status: result.replayed ? 200 : 201, headers: rateLimit.headers },
      );
    } catch (error) {
      const response = careerErrorResponse(error, requestId);
      if (response) return response;
      throw error;
    }
  });
}
