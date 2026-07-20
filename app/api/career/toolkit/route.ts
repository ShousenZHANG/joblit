import { NextResponse } from "next/server";
import { z } from "zod";
import { withSessionRoute, parseJsonBody } from "@/lib/server/api/routeHandler";
import { careerRateLimit } from "@/lib/server/career/api";
import { careerErrorResponse } from "@/lib/server/career/errors";
import {
  createInterviewToolkit,
  createNegotiationToolkit,
} from "@/lib/server/career/toolkitService";

export const runtime = "nodejs";

const BodySchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("interview"),
      requirements: z.array(z.string().trim().min(1).max(1_000)).min(1).max(40),
      locale: z.enum(["en", "zh"]).default("en"),
    })
    .strict(),
  z
    .object({
      action: z.literal("negotiation"),
      offerId: z.string().uuid(),
      strengths: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
      locale: z.enum(["en", "zh"]).default("en"),
    })
    .strict(),
]);

export function POST(req: Request) {
  return withSessionRoute(async ({ userId, requestId }) => {
    const rateLimit = careerRateLimit(userId, "toolkit:post", {
      limit: 20,
      windowSeconds: 60,
    });
    if (!rateLimit.ok) return rateLimit.response;
    const body = await parseJsonBody(req, BodySchema, requestId);
    if (!body.ok) return body.response;
    try {
      const data = body.data.action === "interview"
        ? await createInterviewToolkit(userId, body.data)
        : await createNegotiationToolkit(userId, body.data);
      return NextResponse.json({ data, requestId }, { headers: rateLimit.headers });
    } catch (error) {
      const response = careerErrorResponse(error, requestId);
      if (response) return response;
      throw error;
    }
  });
}
