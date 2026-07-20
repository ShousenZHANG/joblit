import { NextResponse } from "next/server";
import { z } from "zod";
import { withSessionRoute } from "@/lib/server/api/routeHandler";
import { careerRateLimit } from "@/lib/server/career/api";
import { getCareerAnalytics } from "@/lib/server/career/analytics";

export const runtime = "nodejs";

const DateQuerySchema = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value));
const QuerySchema = z
  .object({
    from: DateQuerySchema.optional(),
    to: DateQuerySchema.optional(),
  })
  .strict()
  .refine(
    (value) => !value.from || !value.to || value.from <= value.to,
    { message: "from must be before to" },
  );

export function GET(req: Request) {
  return withSessionRoute(async ({ userId, requestId }) => {
    const rateLimit = careerRateLimit(userId, "analytics:get", {
      limit: 30,
      windowSeconds: 60,
    });
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
    const data = await getCareerAnalytics(userId, query.data);
    return NextResponse.json({ data, requestId }, { headers: rateLimit.headers });
  });
}
