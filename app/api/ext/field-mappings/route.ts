import { NextResponse } from "next/server";
import { requireExtensionToken, ExtensionTokenError } from "@/lib/server/auth/requireExtensionToken";
import { unauthorizedError, errorJson } from "@/lib/server/api/errorResponse";
import { z } from "zod";
import { upsertFieldMappingRule, listFieldMappingRules } from "@/lib/server/extensionSubmission";

export const runtime = "nodejs";

const UpsertMappingSchema = z.object({
  fieldSelector: z.string().min(1).max(500),
  fieldLabel: z.string().max(200).optional(),
  atsProvider: z.string().max(50).optional(),
  pageDomain: z.string().max(200).optional(),
  profilePath: z.string().min(1).max(200),
  staticValue: z.string().max(1000).optional(),
  source: z.enum(["user", "auto"]).optional(),
});

export async function GET(req: Request) {
  try {
    const { userId } = await requireExtensionToken(req);
    const url = new URL(req.url);

    const rules = await listFieldMappingRules({
      userId,
      atsProvider: url.searchParams.get("atsProvider") ?? undefined,
      pageDomain: url.searchParams.get("pageDomain") ?? undefined,
    });

    return NextResponse.json({ data: rules });
  } catch (err) {
    if (err instanceof ExtensionTokenError) return unauthorizedError();
    throw err;
  }
}

export async function PUT(req: Request) {
  try {
    const { userId } = await requireExtensionToken(req);
    const body = await req.json().catch(() => ({}));
    const parsed = UpsertMappingSchema.safeParse(body);

    if (!parsed.success) {
      return errorJson("INVALID_BODY", "Invalid request body", 400, {
        details: parsed.error.flatten(),
      });
    }

    const rule = await upsertFieldMappingRule({ userId, ...parsed.data });
    return NextResponse.json({ data: rule });
  } catch (err) {
    if (err instanceof ExtensionTokenError) return unauthorizedError();
    throw err;
  }
}
