import { NextResponse } from "next/server";
import { requireExtensionToken, ExtensionTokenError } from "@/lib/server/auth/requireExtensionToken";
import { unauthorizedError, errorJson } from "@/lib/server/api/errorResponse";
import { z } from "zod";
import { createFormSubmission, listFormSubmissions } from "@/lib/server/extensionSubmission";

export const runtime = "nodejs";

const CreateSubmissionSchema = z.object({
  pageUrl: z.string().url().max(2000),
  pageDomain: z.string().min(1).max(200),
  atsProvider: z.string().max(50).optional(),
  formSignature: z.string().min(1).max(128),
  fieldValues: z.record(z.string(), z.string()),
  fieldMappings: z.record(z.string(), z.object({
    source: z.string(),
    profilePath: z.string().optional(),
    confidence: z.number().min(0).max(1),
  })),
  jobId: z.string().uuid().optional(),
});

export async function POST(req: Request) {
  try {
    const { userId } = await requireExtensionToken(req);
    const body = await req.json().catch(() => ({}));
    const parsed = CreateSubmissionSchema.safeParse(body);

    if (!parsed.success) {
      return errorJson("INVALID_BODY", "Invalid request body", 400, {
        details: parsed.error.flatten(),
      });
    }

    const result = await createFormSubmission({ userId, ...parsed.data });
    return NextResponse.json({ data: { id: result.id } }, { status: 201 });
  } catch (err) {
    if (err instanceof ExtensionTokenError) return unauthorizedError();
    throw err;
  }
}

export async function GET(req: Request) {
  try {
    const { userId } = await requireExtensionToken(req);
    const url = new URL(req.url);

    const result = await listFormSubmissions({
      userId,
      pageDomain: url.searchParams.get("pageDomain") ?? undefined,
      atsProvider: url.searchParams.get("atsProvider") ?? undefined,
      formSignature: url.searchParams.get("formSignature") ?? undefined,
      limit: Math.min(Number(url.searchParams.get("limit") ?? 50), 100),
      offset: Number(url.searchParams.get("offset") ?? 0),
    });

    return NextResponse.json({ data: result });
  } catch (err) {
    if (err instanceof ExtensionTokenError) return unauthorizedError();
    throw err;
  }
}
