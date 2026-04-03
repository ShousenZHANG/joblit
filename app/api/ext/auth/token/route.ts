import { NextResponse } from "next/server";
import { requireSession, UnauthorizedError } from "@/lib/server/auth/requireSession";
import { unauthorizedError, errorJson } from "@/lib/server/api/errorResponse";
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

/** GET — List active (non-revoked) tokens for the current user. */
export async function GET() {
  try {
    const { userId } = await requireSession();
    const tokens = await listExtensionTokens(userId);
    return NextResponse.json({ data: tokens });
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedError();
    throw err;
  }
}

/** POST — Generate a new extension token. Requires an active session (cookie auth). */
export async function POST(req: Request) {
  try {
    const { userId } = await requireSession();
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
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedError();
    throw err;
  }
}

/** DELETE — Revoke an extension token. */
export async function DELETE(req: Request) {
  try {
    const { userId } = await requireSession();
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
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedError();
    throw err;
  }
}
