import { createHash, randomBytes } from "crypto";

import { prisma } from "@/lib/server/prisma";

export const AGENT_CREDENTIAL_PREFIX = "jfagent_v1_";
export const AGENT_CREDENTIAL_AUDIENCE = "joblit-agent";
export const AGENT_CREDENTIAL_VERSION = 1;
export const AGENT_CAPABILITY = {
  FIT_DRAIN: "fit:drain",
  TAILORING_EXECUTE: "tailoring:execute",
  TAILORING_CONTROL: "tailoring:control",
} as const;
export const DEFAULT_AGENT_CAPABILITIES = [
  AGENT_CAPABILITY.FIT_DRAIN,
  AGENT_CAPABILITY.TAILORING_EXECUTE,
  AGENT_CAPABILITY.TAILORING_CONTROL,
] as const;

export type AgentCapability = (typeof DEFAULT_AGENT_CAPABILITIES)[number];

const TOKEN_BYTES = 32;
const DEFAULT_EXPIRY_DAYS = 90;

export function generateRawAgentToken(): string {
  return AGENT_CREDENTIAL_PREFIX + randomBytes(TOKEN_BYTES).toString("hex");
}

export function hashAgentToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createAgentCredential(
  userId: string,
  name = "Joblit Runner",
  expiryDays = DEFAULT_EXPIRY_DAYS,
  capabilities: readonly AgentCapability[] = DEFAULT_AGENT_CAPABILITIES,
) {
  const rawToken = generateRawAgentToken();
  const expiresAt = new Date(
    Date.now() + expiryDays * 24 * 60 * 60 * 1000,
  );
  const capabilitySnapshot = [...new Set(capabilities)];

  const record = await prisma.agentCredential.create({
    data: {
      userId,
      tokenHash: hashAgentToken(rawToken),
      name,
      audience: AGENT_CREDENTIAL_AUDIENCE,
      version: AGENT_CREDENTIAL_VERSION,
      capabilities: capabilitySnapshot,
      expiresAt,
    },
  });

  return {
    id: record.id,
    rawToken,
    name: record.name,
    audience: record.audience,
    version: record.version,
    capabilities: record.capabilities,
    expiresAt: record.expiresAt,
    createdAt: record.createdAt,
  };
}

export async function listAgentCredentials(userId: string) {
  return prisma.agentCredential.findMany({
    where: { userId, revokedAt: null },
    select: {
      id: true,
      name: true,
      audience: true,
      version: true,
      capabilities: true,
      lastUsedAt: true,
      expiresAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function revokeAgentCredential(
  userId: string,
  credentialId: string,
): Promise<boolean> {
  const result = await prisma.agentCredential.updateMany({
    where: {
      id: credentialId,
      userId,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
  return result.count === 1;
}
