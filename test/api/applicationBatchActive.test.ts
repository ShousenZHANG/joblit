import { beforeEach, describe, expect, it, vi } from "vitest";

const applicationBatchStore = vi.hoisted(() => ({
  findFirst: vi.fn(),
}));

const agentCredentialStore = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    applicationBatch: applicationBatchStore,
    agentCredential: agentCredentialStore,
  },
}));

vi.mock("@/auth", () => ({
  authOptions: {},
}));

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

import { getServerSession } from "next-auth/next";
import { GET } from "@/app/api/application-batches/active/route";

describe("application batch active api", () => {
  beforeEach(() => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockReset();
    applicationBatchStore.findFirst.mockReset();
    agentCredentialStore.findUnique.mockReset();
    agentCredentialStore.updateMany.mockReset();
  });

  it("authenticates the Runner's bearer token end to end", async () => {
    // No cookie session at all — the local Runner presents an AgentCredential
    // and must reach the same handler the browser does.
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      null,
    );
    agentCredentialStore.findUnique.mockResolvedValue({
      id: "token-1",
      userId: "runner-user",
      audience: "joblit-agent",
      version: 1,
      capabilities: ["tailoring:execute"],
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      lastUsedAt: null,
    });
    agentCredentialStore.updateMany.mockResolvedValue({ count: 1 });
    applicationBatchStore.findFirst.mockResolvedValueOnce({
      id: "550e8400-e29b-41d4-a716-446655440000",
      status: "QUEUED",
      updatedAt: new Date("2026-02-22T10:10:00.000Z"),
    });

    const res = await GET(
      new Request("http://localhost/api/application-batches/active", {
        headers: {
          Authorization: `Bearer jfagent_v1_${"a".repeat(64)}`,
        },
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.batchId).toBe("550e8400-e29b-41d4-a716-446655440000");
    // The query was scoped to the token's user, not to any session.
    expect(
      applicationBatchStore.findFirst.mock.calls[0]?.[0]?.where?.userId,
    ).toBe("runner-user");
  });

  it("returns active batch id for current user", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    applicationBatchStore.findFirst.mockResolvedValueOnce({
      id: "550e8400-e29b-41d4-a716-446655440000",
      status: "RUNNING",
      updatedAt: new Date("2026-02-22T10:10:00.000Z"),
    });

    const res = await GET(new Request("http://localhost/api/application-batches/active"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.batchId).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(json.status).toBe("RUNNING");
    expect(typeof json.updatedAt).toBe("string");
    expect(applicationBatchStore.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "user-1",
          status: { in: ["QUEUED", "RUNNING"] },
        }),
      }),
    );
  });

  it("returns null payload when no active batch exists", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    applicationBatchStore.findFirst.mockResolvedValueOnce(null);

    const res = await GET(new Request("http://localhost/api/application-batches/active"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({
      batchId: null,
      status: null,
      updatedAt: null,
    });
  });
});
