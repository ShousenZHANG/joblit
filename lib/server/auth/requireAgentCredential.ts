import { createRequestId } from "@/lib/server/api/errorResponse";
import {
  AGENT_CREDENTIAL_AUDIENCE,
  AGENT_CREDENTIAL_PREFIX,
  AGENT_CREDENTIAL_VERSION,
  DEFAULT_AGENT_CAPABILITIES,
  hashAgentToken,
  type AgentCapability,
} from "@/lib/server/agentCredential";
import { prisma } from "@/lib/server/prisma";

const LAST_USED_AT_WRITE_INTERVAL_MS = 5 * 60 * 1000;
const AGENT_TOKEN_PATTERN = new RegExp(
  `^${AGENT_CREDENTIAL_PREFIX}[0-9a-f]{64}$`,
);
const KNOWN_CAPABILITIES = new Set<string>(DEFAULT_AGENT_CAPABILITIES);

export type AgentCredentialContext = {
  userId: string;
  credentialId: string;
  capabilities: AgentCapability[];
  requestId: string;
};

export class AgentCredentialError extends Error {
  constructor(message = "Invalid agent credential") {
    super(message);
    this.name = "AgentCredentialError";
  }
}

function extractAgentToken(req: Request): string {
  const header = req.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) throw new AgentCredentialError();

  const token = header.slice("Bearer ".length);
  if (!AGENT_TOKEN_PATTERN.test(token)) throw new AgentCredentialError();
  return token;
}

function hasKnownCapabilities(
  capabilities: string[],
): capabilities is AgentCapability[] {
  return capabilities.every((capability) => KNOWN_CAPABILITIES.has(capability));
}

export async function requireAgentCredential(
  req: Request,
  requiredCapability: AgentCapability,
): Promise<AgentCredentialContext> {
  const rawToken = extractAgentToken(req);
  const record = await prisma.agentCredential.findUnique({
    where: { tokenHash: hashAgentToken(rawToken) },
  });
  const now = new Date();

  if (
    !record ||
    record.audience !== AGENT_CREDENTIAL_AUDIENCE ||
    record.version !== AGENT_CREDENTIAL_VERSION ||
    record.revokedAt !== null ||
    record.expiresAt.getTime() <= now.getTime() ||
    !hasKnownCapabilities(record.capabilities) ||
    !record.capabilities.includes(requiredCapability)
  ) {
    throw new AgentCredentialError();
  }

  const lastUsedAtCutoff = new Date(
    now.getTime() - LAST_USED_AT_WRITE_INTERVAL_MS,
  );
  if (!record.lastUsedAt || record.lastUsedAt <= lastUsedAtCutoff) {
    await prisma.agentCredential.updateMany({
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
    credentialId: record.id,
    capabilities: record.capabilities,
    requestId: createRequestId(),
  };
}
