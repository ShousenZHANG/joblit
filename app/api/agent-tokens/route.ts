import { NextResponse } from "next/server";
import { z } from "zod";

import { errorJson } from "@/lib/server/api/errorResponse";
import { parseJsonBody, withSessionRoute } from "@/lib/server/api/routeHandler";
import {
  createExtensionToken,
  listExtensionTokens,
  revokeExtensionToken,
} from "@/lib/server/extensionToken";

export const runtime = "nodejs";

/**
 * Agent tokens authenticate the Joblit Runner and any other external worker
 * against the batch protocol (see AGENTS.md).
 *
 * Deliberately session-only. Minting a token from a Bearer token would let a
 * leaked credential renew itself indefinitely and outlive revocation, so these
 * handlers sit behind `withSessionRoute`, not the `withAgentRoute` seam the
 * protocol routes use.
 */

const DEFAULT_TOKEN_NAME = "Joblit Runner";
const DEFAULT_EXPIRY_DAYS = 90;

const CreateTokenSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  expiryDays: z.number().int().min(1).max(365).optional(),
});

const RevokeTokenSchema = z.object({
  tokenId: z.string().uuid(),
});

/** GET — list the caller's active (non-revoked) tokens. */
export async function GET() {
  return withSessionRoute(async ({ userId }) => {
    const tokens = await listExtensionTokens(userId);
    return NextResponse.json({ data: tokens });
  });
}

/** POST — mint a token. The raw value is returned exactly once. */
export async function POST(req: Request) {
  return withSessionRoute(async ({ userId, requestId }) => {
    const parsed = await parseJsonBody(req, CreateTokenSchema, requestId);
    if (!parsed.ok) {
      return errorJson("INVALID_BODY", "Invalid request body", 400, { requestId });
    }

    const created = await createExtensionToken(
      userId,
      parsed.data.name ?? DEFAULT_TOKEN_NAME,
      parsed.data.expiryDays ?? DEFAULT_EXPIRY_DAYS,
    );

    return NextResponse.json({ data: created }, { status: 201 });
  });
}

/** DELETE — revoke a token the caller owns. */
export async function DELETE(req: Request) {
  return withSessionRoute(async ({ userId, requestId }) => {
    const parsed = await parseJsonBody(req, RevokeTokenSchema, requestId);
    if (!parsed.ok) {
      return errorJson("INVALID_BODY", "tokenId is required", 400, { requestId });
    }

    const revoked = await revokeExtensionToken(userId, parsed.data.tokenId);
    if (!revoked) {
      return errorJson("TOKEN_NOT_FOUND", "Token not found or already revoked", 404, {
        requestId,
      });
    }

    return NextResponse.json({ data: { revoked: true } });
  });
}
