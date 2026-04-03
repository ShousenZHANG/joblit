import { randomBytes, createHash } from "crypto";
import { prisma } from "@/lib/server/prisma";

const TOKEN_PREFIX = "jfext_";
const TOKEN_BYTES = 32;
const DEFAULT_EXPIRY_DAYS = 90;

export function generateRawToken(): string {
  return TOKEN_PREFIX + randomBytes(TOKEN_BYTES).toString("hex");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface CreateTokenResult {
  id: string;
  rawToken: string;
  name: string;
  expiresAt: Date;
  createdAt: Date;
}

export async function createExtensionToken(
  userId: string,
  name = "Chrome Extension",
  expiryDays = DEFAULT_EXPIRY_DAYS,
): Promise<CreateTokenResult> {
  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);

  const record = await prisma.extensionToken.create({
    data: {
      userId,
      tokenHash,
      name,
      expiresAt,
    },
  });

  return {
    id: record.id,
    rawToken, // Only returned once at creation time
    name: record.name,
    expiresAt: record.expiresAt,
    createdAt: record.createdAt,
  };
}

export async function revokeExtensionToken(
  userId: string,
  tokenId: string,
): Promise<boolean> {
  const record = await prisma.extensionToken.findFirst({
    where: { id: tokenId, userId },
  });

  if (!record || record.revokedAt) {
    return false;
  }

  await prisma.extensionToken.update({
    where: { id: tokenId },
    data: { revokedAt: new Date() },
  });

  return true;
}

export async function listExtensionTokens(userId: string) {
  return prisma.extensionToken.findMany({
    where: { userId, revokedAt: null },
    select: {
      id: true,
      name: true,
      lastUsedAt: true,
      expiresAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
}
