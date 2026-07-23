import { NextResponse } from "next/server";
import { withSessionRoute } from "@/lib/server/api/routeHandler";
import { z } from "zod";
import {
  createPromptRuleTemplate,
  listPromptRuleTemplates,
} from "@/lib/server/promptRuleTemplates";

export const runtime = "nodejs";

const CreateRuleSchema = z.object({
  name: z.string().min(1),
  cvRules: z.array(z.string()).min(1),
  coverRules: z.array(z.string()).min(1),
  hardConstraints: z.array(z.string()).min(1),
});

function normalizeRuleList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

export async function GET() {
  return withSessionRoute(async ({ userId, requestId }) => {
    const templates = await listPromptRuleTemplates(userId);
    return NextResponse.json({
      requestId,
      templates: templates.map((template) => ({
        id: template.id,
        name: template.name,
        version: template.version,
        locale: template.locale,
        isActive: template.isActive,
        cvRules: normalizeRuleList(template.cvRules),
        coverRules: normalizeRuleList(template.coverRules),
        hardConstraints: normalizeRuleList(template.hardConstraints),
        createdAt: template.createdAt,
        updatedAt: template.updatedAt,
      })),
    });
  });
}

export async function POST(req: Request) {
  return withSessionRoute(async ({ userId, requestId }) => {
    const payload = await req.json().catch(() => null);
    const parsed = CreateRuleSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_BODY",
            message: "Invalid request body",
            details: parsed.error.flatten(),
          },
          requestId,
        },
        { status: 400 },
      );
    }

    const created = await createPromptRuleTemplate(userId, parsed.data);
    return NextResponse.json(
      {
        requestId,
        template: {
          id: created.id,
          name: created.name,
          version: created.version,
          locale: created.locale,
          isActive: created.isActive,
        },
      },
      { status: 201 },
    );
  });
}

