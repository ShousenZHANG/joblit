import { NextResponse } from "next/server";
import { errorJson } from "@/lib/server/api/errorResponse";
import { withSessionRoute } from "@/lib/server/api/routeHandler";
import { z } from "zod";
import { listJobs } from "@/lib/server/jobs/jobListService";
import { JOB_STATUS_VALUES } from "@/lib/shared/jobStatus";

export const runtime = "nodejs";

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(10),
  cursor: z.string().uuid().optional(),
  status: z.enum(JOB_STATUS_VALUES).optional(),
  q: z.string().trim().min(1).max(80).optional(),
  location: z.string().trim().min(1).max(80).optional(),
  jobLevel: z.string().trim().min(1).max(80).optional(),
  sort: z.enum(["newest", "oldest", "fit"]).optional().default("newest"),
  fitBand: z.enum(["strong", "good", "moderate", "low", "unscored"]).optional(),
  market: z.enum(["AU", "CN"]).optional(),
  platform: z.string().trim().min(1).max(80).optional(),
});

export async function GET(req: Request) {
  return withSessionRoute(async ({ userId }) => {
    const ifNoneMatch = req.headers.get("if-none-match");

    const url = new URL(req.url);
    const parsed = QuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) {
      return errorJson("INVALID_QUERY", "Invalid query parameters", 400, {
        details: parsed.error.flatten(),
      });
    }

    const result = await listJobs(userId, parsed.data);

    if (ifNoneMatch && ifNoneMatch === result.etag) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          ETag: result.etag,
          "Cache-Control": "private, max-age=0, must-revalidate",
        },
      });
    }

    return new NextResponse(
      JSON.stringify({
        items: result.items,
        nextCursor: result.nextCursor,
        totalCount: result.totalCount,
        facets: result.facets,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ETag: result.etag,
          "Cache-Control": "private, max-age=0, must-revalidate",
        },
      },
    );
  });
}

