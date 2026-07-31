import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { z } from "zod";

/**
 * The agent auth seam.
 *
 * The batch protocol (create/claim/prompt/import) sat behind the browser
 * session only, so the documented external worker — Codex, and now the local
 * Runner — had no first-class way in; AGENTS.md never even had an auth
 * section. withAgentRoute accepts either identity for the same handler:
 * a Bearer ExtensionToken when the header is present, the session cookie
 * otherwise. Both produce the same SessionContext, so handlers cannot tell
 * the difference and need no changes.
 */

// Fully mocked: importing the real modules drags in auth.ts and prisma, which
// demand env this unit test does not need.
const auth = vi.hoisted(() => {
  class UnauthorizedError extends Error {
    constructor() {
      super("Unauthorized");
      this.name = "UnauthorizedError";
    }
  }
  class ExtensionTokenError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "ExtensionTokenError";
    }
  }
  return {
    requireSession: vi.fn(),
    requireSessionWithEmail: vi.fn(),
    requireExtensionToken: vi.fn(),
    UnauthorizedError,
    ExtensionTokenError,
  };
});

vi.mock("@/lib/server/auth/requireSession", () => ({
  requireSession: auth.requireSession,
  requireSessionWithEmail: auth.requireSessionWithEmail,
  UnauthorizedError: auth.UnauthorizedError,
}));

vi.mock("@/lib/server/auth/requireExtensionToken", () => ({
  requireExtensionToken: auth.requireExtensionToken,
  ExtensionTokenError: auth.ExtensionTokenError,
}));

import { withAgentRoute } from "@/lib/server/api/routeHandler";

const { UnauthorizedError, ExtensionTokenError } = auth;

function request(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/test", { headers });
}

beforeEach(() => {
  auth.requireSession.mockReset();
  auth.requireExtensionToken.mockReset();
});

describe("withAgentRoute", () => {
  it("authenticates a bearer token without touching the session", async () => {
    auth.requireExtensionToken.mockResolvedValue({
      userId: "user-1",
      tokenId: "token-1",
      requestId: "req-1",
    });

    const res = await withAgentRoute(
      request({ Authorization: "Bearer tok" }),
      async ({ userId, requestId }) =>
        NextResponse.json({ userId, requestId }),
    );

    await expect(res.json()).resolves.toEqual({
      userId: "user-1",
      requestId: "req-1",
    });
    expect(auth.requireSession).not.toHaveBeenCalled();
  });

  it("falls back to the session when no Authorization header is present", async () => {
    auth.requireSession.mockResolvedValue({
      userId: "user-2",
      requestId: "req-2",
    });

    const res = await withAgentRoute(request(), async ({ userId }) =>
      NextResponse.json({ userId }),
    );

    await expect(res.json()).resolves.toEqual({ userId: "user-2" });
    expect(auth.requireExtensionToken).not.toHaveBeenCalled();
  });

  it("rejects an invalid bearer token as 401 without a session fallback", async () => {
    // A caller that presented a token asked to be judged as a token holder.
    // Falling back to a cookie would let a revoked token keep working from a
    // browser, which defeats revocation.
    auth.requireExtensionToken.mockRejectedValue(
      new ExtensionTokenError("Invalid or expired token"),
    );

    const res = await withAgentRoute(
      request({ Authorization: "Bearer bad" }),
      async () => NextResponse.json({ ok: true }),
    );

    expect(res.status).toBe(401);
    expect(auth.requireSession).not.toHaveBeenCalled();
  });

  it("rejects a missing session as 401", async () => {
    auth.requireSession.mockRejectedValue(new UnauthorizedError());

    const res = await withAgentRoute(request(), async () =>
      NextResponse.json({ ok: true }),
    );

    expect(res.status).toBe(401);
  });

  it("keeps the two identities from cross-contaminating", async () => {
    // Bearer first, then a plain-session call: neither leaks state into the
    // other, and each consults only its own authenticator.
    auth.requireExtensionToken.mockResolvedValue({
      userId: "runner-user",
      tokenId: "token-1",
      requestId: "req-a",
    });
    auth.requireSession.mockResolvedValue({
      userId: "browser-user",
      requestId: "req-b",
    });

    const asRunner = await withAgentRoute(
      request({ Authorization: "Bearer tok" }),
      async ({ userId }) => NextResponse.json({ userId }),
    );
    const asBrowser = await withAgentRoute(request(), async ({ userId }) =>
      NextResponse.json({ userId }),
    );

    await expect(asRunner.json()).resolves.toEqual({ userId: "runner-user" });
    await expect(asBrowser.json()).resolves.toEqual({ userId: "browser-user" });
    expect(auth.requireExtensionToken).toHaveBeenCalledTimes(1);
    expect(auth.requireSession).toHaveBeenCalledTimes(1);
  });

  it("validates params exactly like withSessionRoute", async () => {
    auth.requireSession.mockResolvedValue({
      userId: "user-2",
      requestId: "req-2",
    });

    const good = await withAgentRoute(
      request(),
      async ({ params }) => NextResponse.json({ id: params.id }),
      {
        params: Promise.resolve({ id: "550e8400-e29b-41d4-a716-446655440000" }),
        schema: z.object({ id: z.string().uuid() }),
      },
    );
    await expect(good.json()).resolves.toEqual({
      id: "550e8400-e29b-41d4-a716-446655440000",
    });

    const bad = await withAgentRoute(
      request(),
      async () => NextResponse.json({ ok: true }),
      {
        params: Promise.resolve({ id: "not-a-uuid" }),
        schema: z.object({ id: z.string().uuid() }),
      },
    );
    expect(bad.status).toBe(400);
  });
});
