import { NextResponse } from "next/server";
import { z } from "zod";

import { errorJson, unauthorizedError, validationError } from "@/lib/server/api/errorResponse";
import { checkRateLimit, rateLimitHeaders } from "@/lib/server/api/rateLimit";
import {
  ExtensionTokenError,
  requireExtensionToken,
} from "@/lib/server/auth/requireExtensionToken";
import { prisma } from "@/lib/server/prisma";

export const runtime = "nodejs";

const SETTINGS_RATE_LIMIT = { limit: 30, windowSeconds: 60 } as const;

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

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

async function authenticate(req: Request) {
  try {
    return await requireExtensionToken(req);
  } catch (error) {
    if (error instanceof ExtensionTokenError) return null;
    throw error;
  }
}

export async function GET(req: Request) {
  const auth = await authenticate(req);
  if (!auth) return noStore(unauthorizedError());

  const setting = await prisma.localAiSetting.findUnique({
    where: { userId: auth.userId },
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
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PUT(req: Request) {
  const auth = await authenticate(req);
  if (!auth) return noStore(unauthorizedError());

  const rateLimit = checkRateLimit(`ext:local-ai:settings:${auth.userId}`, SETTINGS_RATE_LIMIT);
  if (!rateLimit.allowed) {
    return errorJson("RATE_LIMITED", "Too many requests", 429, {
      headers: { ...rateLimitHeaders(rateLimit), "Cache-Control": "no-store" },
    });
  }

  const json = await req.json().catch(() => null);
  const parsed = PutSchema.safeParse(json);
  if (!parsed.success) {
    // Reject any attempt to sync a secret-looking payload loudly.
    if (json && typeof json === "object" && ("apiKey" in json || "key" in json || "token" in json)) {
      return noStore(errorJson("INVALID_BODY", "Secrets must never be synced", 400));
    }
    return noStore(validationError(parsed.error, auth.requestId));
  }

  await prisma.localAiSetting.upsert({
    where: { userId: auth.userId },
    create: {
      userId: auth.userId,
      hermesEndpoint: parsed.data.hermesEndpoint,
      hermesProfile: parsed.data.hermesProfile,
    },
    update: {
      hermesEndpoint: parsed.data.hermesEndpoint,
      hermesProfile: parsed.data.hermesProfile,
    },
  });
  return NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}
