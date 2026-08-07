import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Runner presence, inferred rather than reported.
 *
 * Every authenticated Runner call refreshes AgentCredential.lastUsedAt behind
 * a five-minute write throttle, so the most recent value across the user's
 * credentials is a free liveness signal with five-minute precision. The route
 * only reads; the Runner needs no changes and no new protocol surface.
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

beforeEach(() => {
  vi.clearAllMocks();
  auth.requireSession.mockResolvedValue({ userId: USER_ID, requestId: "req-1" });
});

describe("GET /api/agent/presence", () => {
  it("returns the newest lastUsedAt across the caller's live credentials", async () => {
    const seen = new Date("2026-08-07T10:00:00.000Z");
    prisma.agentCredential.findFirst.mockResolvedValue({ lastUsedAt: seen });

    const res = await GET();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      lastUsedAt: seen.toISOString(),
    });
    // Scoped to the caller and to credentials that can still authenticate:
    // a revoked or expired credential's activity is not presence.
    expect(prisma.agentCredential.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: USER_ID,
          revokedAt: null,
          expiresAt: expect.objectContaining({ gt: expect.any(Date) }),
        }),
        orderBy: { lastUsedAt: "desc" },
      }),
    );
  });

  it("reports null when no credential has ever been used", async () => {
    prisma.agentCredential.findFirst.mockResolvedValue(null);

    const res = await GET();

    await expect(res.json()).resolves.toEqual({ lastUsedAt: null });
  });

  it("requires a session", async () => {
    auth.requireSession.mockRejectedValue(new auth.UnauthorizedError());

    const res = await GET();

    expect(res.status).toBe(401);
    expect(prisma.agentCredential.findFirst).not.toHaveBeenCalled();
  });
});
