import { NextResponse } from "next/server";
import { withSessionRoute } from "@/lib/server/api/routeHandler";
import { errorJson } from "@/lib/server/api/errorResponse";
import { checkRateLimit, rateLimitKeyFromRequest, rateLimitHeaders } from "@/lib/server/api/rateLimit";
import { z } from "zod";
import {
  createExtensionToken,
  revokeExtensionToken,
  listExtensionTokens,
} from "@/lib/server/extensionToken";

export const runtime = "nodejs";

const CreateTokenSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  expiryDays: z.number().int().min(1).max(365).optional(),
});

const RevokeTokenSchema = z.object({
  tokenId: z.string().uuid(),
});

// The rate limit is keyed by request rather than by user and stays outside the
// session wrapper on purpose: it throttles anonymous callers before they can
// drive a session lookup against the database.

/** GET — List active (non-revoked) tokens for the current user. */
export async function GET(req: Request) {
  const rl = checkRateLimit(rateLimitKeyFromRequest(req, "ext:token:list"), { limit: 30, windowSeconds: 60 });
  if (!rl.allowed) return errorJson("RATE_LIMITED", "Too many requests", 429, { headers: rateLimitHeaders(rl) });

  return withSessionRoute(async ({ userId }) => {
    const tokens = await listExtensionTokens(userId);
    return NextResponse.json({ data: tokens });
  });
}

/** POST — Generate a new extension token. Requires an active session (cookie auth). */
export async function POST(req: Request) {
  const rl = checkRateLimit(rateLimitKeyFromRequest(req, "ext:token:create"), { limit: 10, windowSeconds: 60 });
  if (!rl.allowed) return errorJson("RATE_LIMITED", "Too many requests", 429, { headers: rateLimitHeaders(rl) });

  return withSessionRoute(async ({ userId }) => {
    const body = await req.json().catch(() => ({}));
    const parsed = CreateTokenSchema.safeParse(body);

    if (!parsed.success) {
      return errorJson("INVALID_BODY", "Invalid request body", 400, {
        details: parsed.error.flatten(),
      });
    }

    const { name, expiryDays } = parsed.data;
    const result = await createExtensionToken(userId, name, expiryDays);

    return NextResponse.json({ data: result }, { status: 201 });
  });
}

/** DELETE — Revoke an extension token. */
export async function DELETE(req: Request) {
  const rl = checkRateLimit(rateLimitKeyFromRequest(req, "ext:token:revoke"), { limit: 20, windowSeconds: 60 });
  if (!rl.allowed) return errorJson("RATE_LIMITED", "Too many requests", 429, { headers: rateLimitHeaders(rl) });

  return withSessionRoute(async ({ userId }) => {
    const body = await req.json().catch(() => ({}));
    const parsed = RevokeTokenSchema.safeParse(body);

    if (!parsed.success) {
      return errorJson("INVALID_BODY", "tokenId is required", 400, {
        details: parsed.error.flatten(),
      });
    }

    const revoked = await revokeExtensionToken(userId, parsed.data.tokenId);

    if (!revoked) {
      return errorJson("TOKEN_NOT_FOUND", "Token not found or already revoked", 404);
    }

    return NextResponse.json({ data: { revoked: true } });
  });
}
