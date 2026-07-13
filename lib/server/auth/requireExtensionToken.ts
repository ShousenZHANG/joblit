import { prisma } from "@/lib/server/prisma";
import { createRequestId } from "@/lib/server/api/errorResponse";
import { hashToken } from "@/lib/server/extensionToken";

export { hashToken };

const LAST_USED_AT_WRITE_INTERVAL_MS = 5 * 60 * 1000;

type ExtensionTokenContext = {
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

  const now = new Date();

  if (!record || record.revokedAt || record.expiresAt < now) {
    throw new ExtensionTokenError("Invalid or expired token");
  }

  const lastUsedAtCutoff = new Date(
    now.getTime() - LAST_USED_AT_WRITE_INTERVAL_MS,
  );
  if (!record.lastUsedAt || record.lastUsedAt <= lastUsedAtCutoff) {
    await prisma.extensionToken.updateMany({
      where: {
        id: record.id,
        OR: [
          { lastUsedAt: null },
          { lastUsedAt: { lte: lastUsedAtCutoff } },
        ],
      },
      data: { lastUsedAt: now },
    });
  }

  return {
    userId: record.userId,
    tokenId: record.id,
    requestId: createRequestId(),
  };
}
