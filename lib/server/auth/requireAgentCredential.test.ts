import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    agentCredential: {
      findUnique: prisma.findUnique,
      updateMany: prisma.updateMany,
    },
  },
}));

import {
  AgentCredentialError,
  requireAgentCredential,
} from "./requireAgentCredential";
import {
  AGENT_CREDENTIAL_AUDIENCE,
  AGENT_CREDENTIAL_VERSION,
  hashAgentToken,
} from "../agentCredential";

const RAW_TOKEN = `jfagent_v1_${"a".repeat(64)}`;
const NOW = new Date("2026-07-31T12:00:00.000Z");

function request(token?: string): Request {
  const headers = new Headers();
  if (token !== undefined) headers.set("Authorization", `Bearer ${token}`);
  return new Request("https://joblit.test/api/jobs/fit/next-batch", {
    headers,
  });
}

function validRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "credential-1",
    userId: "user-1",
    tokenHash: hashAgentToken(RAW_TOKEN),
    name: "Runner",
    audience: AGENT_CREDENTIAL_AUDIENCE,
    version: AGENT_CREDENTIAL_VERSION,
    // Pre-retirement rows carry the retired "fit:drain" value (ADR-0019).
    // Validation must tolerate it, or every old credential bricks at once.
    capabilities: ["fit:drain", "tailoring:execute", "tailoring:control"],
    lastUsedAt: null,
    expiresAt: new Date("2026-08-31T00:00:00.000Z"),
    revokedAt: null,
    createdAt: new Date("2026-07-31T00:00:00.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  prisma.updateMany.mockResolvedValue({ count: 1 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("requireAgentCredential", () => {
  it("authenticates a v1 Joblit Agent credential with the required capability", async () => {
    prisma.findUnique.mockResolvedValue(validRecord());

    const context = await requireAgentCredential(
      request(RAW_TOKEN),
      "tailoring:execute",
    );

    expect(context).toEqual({
      userId: "user-1",
      credentialId: "credential-1",
      capabilities: ["fit:drain", "tailoring:execute", "tailoring:control"],
      requestId: expect.any(String),
    });
    expect(prisma.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: hashAgentToken(RAW_TOKEN) },
    });
  });

  it("rejects every retired jfext_ token before touching the database", async () => {
    const retiredToken = `jfext_${"b".repeat(64)}`;

    await expect(
      requireAgentCredential(request(retiredToken), "tailoring:execute"),
    ).rejects.toBeInstanceOf(AgentCredentialError);
    expect(prisma.findUnique).not.toHaveBeenCalled();
    expect(prisma.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong audience", { audience: "browser-extension" }],
    ["wrong contract version", { version: 2 }],
    ["expired", { expiresAt: NOW }],
    ["revoked", { revokedAt: NOW }],
    ["missing capability", { capabilities: ["tailoring:control"] }],
  ])("rejects a credential with %s", async (_reason, override) => {
    prisma.findUnique.mockResolvedValue(validRecord(override));

    await expect(
      requireAgentCredential(request(RAW_TOKEN), "tailoring:execute"),
    ).rejects.toBeInstanceOf(AgentCredentialError);
    expect(prisma.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a missing or malformed Bearer credential without a lookup", async () => {
    await expect(
      requireAgentCredential(request(), "tailoring:execute"),
    ).rejects.toBeInstanceOf(AgentCredentialError);
    await expect(
      requireAgentCredential(request("not-an-agent-token"), "tailoring:execute"),
    ).rejects.toBeInstanceOf(AgentCredentialError);

    expect(prisma.findUnique).not.toHaveBeenCalled();
  });

  it("refreshes last-seen often enough for a low-latency Runner status", async () => {
    prisma.findUnique.mockResolvedValue(validRecord());

    await requireAgentCredential(request(RAW_TOKEN), "tailoring:execute");

    expect(prisma.updateMany).toHaveBeenCalledWith({
      where: {
        id: "credential-1",
        OR: [
          { lastUsedAt: null },
          { lastUsedAt: { lte: new Date("2026-07-31T11:59:45.000Z") } },
        ],
      },
      data: { lastUsedAt: NOW },
    });
  });
});
