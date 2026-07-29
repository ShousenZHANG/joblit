import { NextResponse } from "next/server";
import { errorJson } from "@/lib/server/api/errorResponse";
import { withExtensionRoute } from "@/lib/server/extensionIngress/withExtensionRoute";
import {
  createFormSubmission,
  listFormSubmissions,
  SubmissionJobAccessError,
} from "@/lib/server/extensionSubmission";
import { CreateSubmissionSchema } from "@/lib/server/extensionSubmissionPayload";

export const runtime = "nodejs";

/**
 * Parse a numeric query param safely. `Number("abc")` is NaN, which Prisma
 * rejects with a validation error (raw 500) when used as take/skip; fall back
 * to `def` and clamp into [min, max].
 */
function clampInt(raw: string | null, def: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

export async function POST(req: Request) {
  return withExtensionRoute(
    req,
    "submissions.create",
    async ({ userId, requestId }) => {
      const body = await req.json().catch(() => ({}));
      const parsed = CreateSubmissionSchema.safeParse(body);

      if (!parsed.success) {
        return errorJson("INVALID_BODY", "Invalid request body", 400, {
          details: parsed.error.flatten(),
          requestId,
        });
      }

      try {
        const result = await createFormSubmission({ userId, ...parsed.data });
        return NextResponse.json({ data: { id: result.id } }, { status: 201 });
      } catch (error) {
        if (error instanceof SubmissionJobAccessError) {
          return errorJson(
            "INVALID_JOB",
            "The referenced job is not available.",
            400,
            { requestId },
          );
        }
        throw error;
      }
    },
  );
}

export async function GET(req: Request) {
  return withExtensionRoute(
    req,
    "submissions.list",
    async ({ userId }) => {
      const url = new URL(req.url);

      const result = await listFormSubmissions({
        userId,
        pageDomain: url.searchParams.get("pageDomain") ?? undefined,
        atsProvider: url.searchParams.get("atsProvider") ?? undefined,
        formSignature: url.searchParams.get("formSignature") ?? undefined,
        limit: clampInt(url.searchParams.get("limit"), 50, 1, 100),
        offset: clampInt(
          url.searchParams.get("offset"),
          0,
          0,
          Number.MAX_SAFE_INTEGER,
        ),
      });

      return NextResponse.json({ data: result });
    },
  );
}
