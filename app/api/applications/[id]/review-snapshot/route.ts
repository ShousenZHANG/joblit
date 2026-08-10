import { NextResponse } from "next/server";
import { errorJson } from "@/lib/server/api/errorResponse";
import { withSessionRoute } from "@/lib/server/api/routeHandler";
import { loadApplicationReviewSnapshot } from "@/lib/server/applications/applicationReviewSnapshot";
import { UuidParamSchema } from "@/lib/shared/schemas/common";

export const runtime = "nodejs";

const PRIVATE_NO_STORE = "private, no-store, max-age=0";

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", PRIVATE_NO_STORE);
  return response;
}

/** Load an owned Application only when the user explicitly opens Review & Edit. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const response = await withSessionRoute(
    async ({ userId, requestId, params }) => {
      const result = await loadApplicationReviewSnapshot({
        userId,
        applicationId: params.id,
      });
      if (result.kind === "not_found") {
        return noStore(
          errorJson("NOT_FOUND", "Application not found", 404, { requestId }),
        );
      }
      if (result.kind === "busy") {
        return noStore(
          errorJson(
            "APPLICATION_REVIEW_SETTLING",
            "Generation is still settling. Try Review & Edit again shortly.",
            409,
            { requestId },
          ),
        );
      }
      if (result.kind === "legacy") {
        return noStore(
          errorJson(
            "APPLICATION_REVIEW_UNAVAILABLE",
            "This generated document cannot be edited safely. Generate it again first.",
            409,
            { requestId },
          ),
        );
      }
      return NextResponse.json(result.snapshot, {
        status: 200,
        headers: { "Cache-Control": PRIVATE_NO_STORE },
      });
    },
    { params: context.params, schema: UuidParamSchema },
  );
  return noStore(response);
}
