import { createHash } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  create: vi.fn(),
  findMany: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    agentCredential: {
      create: prisma.create,
      findMany: prisma.findMany,
      updateMany: prisma.updateMany,
    },
  },
}));

import {
  AGENT_CREDENTIAL_AUDIENCE,
  AGENT_CREDENTIAL_VERSION,
  DEFAULT_AGENT_CAPABILITIES,
  createAgentCredential,
  generateRawAgentToken,
  listAgentCredentials,
  revokeAgentCredential,
} from "./agentCredential";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generateRawAgentToken", () => {
  it("issues a versioned Agent credential that cannot be confused with jfext_", () => {
    const token = generateRawAgentToken();

    expect(token).toMatch(/^jfagent_v1_[0-9a-f]{64}$/);
    expect(token).not.toMatch(/^jfext_/);
  });
});

describe("createAgentCredential", () => {
  it("stores only a hash and binds the credential contract at issuance", async () => {
    const createdAt = new Date("2026-07-31T08:00:00.000Z");
    prisma.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: "credential-1",
          ...data,
          createdAt,
        }),
    );

    const result = await createAgentCredential(
      "user-1",
      "Home Runner",
      30,
      ["fit:drain"],
    );

    expect(result.rawToken).toMatch(/^jfagent_v1_/);
    expect(result).toMatchObject({
      id: "credential-1",
      name: "Home Runner",
      audience: AGENT_CREDENTIAL_AUDIENCE,
      version: AGENT_CREDENTIAL_VERSION,
      capabilities: ["fit:drain"],
      createdAt,
    });
    expect(prisma.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        tokenHash: createHash("sha256")
          .update(result.rawToken)
          .digest("hex"),
        name: "Home Runner",
        audience: "joblit-agent",
        version: 1,
        capabilities: ["fit:drain"],
        expiresAt: expect.any(Date),
      }),
    });
    expect(prisma.create.mock.calls[0][0].data).not.toHaveProperty("rawToken");
  });

  it("issues the complete Runner capability set by default", async () => {
    prisma.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: "credential-2",
          ...data,
          createdAt: new Date(),
        }),
    );

    const result = await createAgentCredential("user-1");

    expect(result.capabilities).toEqual(DEFAULT_AGENT_CAPABILITIES);
    expect(prisma.create.mock.calls[0][0].data.capabilities).toEqual(
      DEFAULT_AGENT_CAPABILITIES,
    );
  });
});

describe("Agent credential management", () => {
  it("lists only the caller's non-revoked credentials without their hashes", async () => {
    const records = [
      {
        id: "credential-1",
        name: "Runner",
        audience: "joblit-agent",
        version: 1,
        capabilities: ["fit:drain"],
        lastUsedAt: null,
        expiresAt: new Date("2026-09-01T00:00:00.000Z"),
        createdAt: new Date("2026-07-31T00:00:00.000Z"),
      },
    ];
    prisma.findMany.mockResolvedValue(records);

    await expect(listAgentCredentials("user-1")).resolves.toEqual(records);
    expect(prisma.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1", revokedAt: null },
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
  });

  it("revokes only a credential owned by the caller", async () => {
    prisma.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      revokeAgentCredential("user-1", "credential-1"),
    ).resolves.toBe(true);
    expect(prisma.updateMany).toHaveBeenCalledWith({
      where: {
        id: "credential-1",
        userId: "user-1",
        revokedAt: null,
      },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it("atomically hides absent, foreign, and already-revoked credentials", async () => {
    prisma.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      revokeAgentCredential("user-1", "missing"),
    ).resolves.toBe(false);
    expect(prisma.updateMany).toHaveBeenCalledOnce();
  });
});
