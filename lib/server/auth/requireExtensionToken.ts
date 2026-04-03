import { prisma } from "@/lib/server/prisma";
import { createRequestId } from "@/lib/server/api/errorResponse";
import { hashToken } from "@/lib/server/extensionToken";

export { hashToken };

export type ExtensionTokenContext = {
  userId: string;
  tokenId: string;
  requestId: string;
};

export class ExtensionTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtensionTokenError";
  }
}

function extractBearerToken(req: Request): string {
  const header = req.headers.get("Authorization");
  if (!header || !header.startsWith("Bearer ")) {
    throw new ExtensionTokenError("Missing or invalid Authorization header");
  }
  const token = header.slice(7);
  if (!token) {
    throw new ExtensionTokenError("Missing or invalid Authorization header");
  }
  return token;
}

export async function requireExtensionToken(
  req: Request,
): Promise<ExtensionTokenContext> {
  const rawToken = extractBearerToken(req);
  const tokenHash = hashToken(rawToken);

  const record = await prisma.extensionToken.findFirst({
    where: { tokenHash },
  });

  if (!record || record.revokedAt || record.expiresAt < new Date()) {
    throw new ExtensionTokenError("Invalid or expired token");
  }

  // Update lastUsedAt asynchronously (fire-and-forget is fine here,
  // but we await in tests for determinism)
  await prisma.extensionToken.update({
    where: { id: record.id },
    data: { lastUsedAt: new Date() },
  });

  return {
    userId: record.userId,
    tokenId: record.id,
    requestId: createRequestId(),
  };
}
