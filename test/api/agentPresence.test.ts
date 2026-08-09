import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Runner presence, inferred rather than reported.
 *
 * Authenticated Runner calls refresh AgentCredential.lastUsedAt. The route
 * turns that activity into a short-lived, server-clock presence signal.
 */

const prisma = vi.hoisted(() => ({
  agentCredential: { findFirst: vi.fn() },
}));
const auth = vi.hoisted(() => {
  class UnauthorizedError extends Error {
    constructor() {
      super("Unauthorized");
      this.name = "UnauthorizedError";
    }
  }
  return {
    requireSession: vi.fn(),
    requireSessionWithEmail: vi.fn(),
    UnauthorizedError,
  };
});

vi.mock("@/lib/server/prisma", () => ({ prisma }));
vi.mock("@/lib/server/auth/requireSession", () => auth);

import { GET } from "@/app/api/agent/presence/route";

const USER_ID = "user-1";
const NOW = new Date("2026-08-07T10:00:10.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  auth.requireSession.mockResolvedValue({
    userId: USER_ID,
    requestId: "req-1",
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/agent/presence", () => {
  it("returns the newest lastUsedAt across the caller's live credentials", async () => {
    const seen = new Date("2026-08-07T10:00:00.000Z");
    prisma.agentCredential.findFirst.mockResolvedValue({ lastUsedAt: seen });

    const res = await GET();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      status: "online",
      lastUsedAt: seen.toISOString(),
      checkedAt: NOW.toISOString(),
      onlineWindowMs: 90_000,
    });
    // Scoped to the caller and to credentials that can still authenticate:
    // a revoked or expired credential's activity is not presence.
    expect(prisma.agentCredential.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: USER_ID,
          revokedAt: null,
          expiresAt: expect.objectContaining({ gt: expect.any(Date) }),
          lastUsedAt: { not: null },
        }),
        orderBy: { lastUsedAt: "desc" },
      }),
    );
  });

  it("reports null when no credential has ever been used", async () => {
    prisma.agentCredential.findFirst.mockResolvedValue(null);

    const res = await GET();

    await expect(res.json()).resolves.toEqual({
      status: "offline",
      lastUsedAt: null,
      checkedAt: NOW.toISOString(),
      onlineWindowMs: 90_000,
    });
  });

  it("stays online between the Runner's sixty-second Fit heartbeats", async () => {
    const seen = new Date(NOW.getTime() - 70_000);
    prisma.agentCredential.findFirst.mockResolvedValue({ lastUsedAt: seen });

    const res = await GET();

    await expect(res.json()).resolves.toMatchObject({
      status: "online",
      lastUsedAt: seen.toISOString(),
      onlineWindowMs: 90_000,
    });
  });

  it("requires a session", async () => {
    auth.requireSession.mockRejectedValue(new auth.UnauthorizedError());

    const res = await GET();

    expect(res.status).toBe(401);
    expect(prisma.agentCredential.findFirst).not.toHaveBeenCalled();
  });
});
