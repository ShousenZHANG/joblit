import { NextResponse } from "next/server";
import { z } from "zod";

import { errorJson, validationError } from "@/lib/server/api/errorResponse";
import { withExtensionRoute } from "@/lib/server/extensionIngress/withExtensionRoute";
import { prisma } from "@/lib/server/prisma";

export const runtime = "nodejs";

// Mirrors the extension's loopback + profile rules. Only non-secret values —
// the Hermes API key must never reach this endpoint.
const LOOPBACK_URL_RE = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):(\d{1,5})\/?$/i;
const HERMES_PROFILE_NAME_RE = /^joblit-[a-f0-9]{16,64}$/;

const PutSchema = z
  .object({
    hermesEndpoint: z
      .string()
      .max(64)
      .refine((value) => LOOPBACK_URL_RE.test(value), "endpoint must be a loopback URL"),
    hermesProfile: z.string().regex(HERMES_PROFILE_NAME_RE, "invalid profile name"),
  })
  .strict();

export async function GET(req: Request) {
  return withExtensionRoute(req, "localAiSettings.read", async ({ userId }) => {
    const setting = await prisma.localAiSetting.findUnique({
      where: { userId },
      select: { hermesEndpoint: true, hermesProfile: true, updatedAt: true },
    });
    return NextResponse.json(
      setting
        ? {
            hermesEndpoint: setting.hermesEndpoint,
            hermesProfile: setting.hermesProfile,
            updatedAt: setting.updatedAt.toISOString(),
          }
        : null,
    );
  });
}

export async function PUT(req: Request) {
  return withExtensionRoute(
    req,
    "localAiSettings.write",
    async ({ userId, requestId }) => {
      const json = await req.json().catch(() => null);
      const parsed = PutSchema.safeParse(json);
      if (!parsed.success) {
        // Reject any attempt to sync a secret-looking payload loudly.
        if (
          json &&
          typeof json === "object" &&
          ("apiKey" in json || "key" in json || "token" in json)
        ) {
          return errorJson(
            "INVALID_BODY",
            "Secrets must never be synced",
            400,
            { requestId },
          );
        }
        return validationError(parsed.error, requestId);
      }

      await prisma.localAiSetting.upsert({
        where: { userId },
        create: {
          userId,
          hermesEndpoint: parsed.data.hermesEndpoint,
          hermesProfile: parsed.data.hermesProfile,
        },
        update: {
          hermesEndpoint: parsed.data.hermesEndpoint,
          hermesProfile: parsed.data.hermesProfile,
        },
      });
      return NextResponse.json({ ok: true });
    }
  );
}
