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
 * a capability-scoped AgentCredential when the header is present, the session
 * cookie otherwise. Handlers receive the authentication kind so strict Agent
 * protocol routes cannot be downgraded to a browser-only compatibility lane.
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
  class AgentCredentialError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "AgentCredentialError";
    }
  }
  return {
    requireSession: vi.fn(),
    requireSessionWithEmail: vi.fn(),
    requireAgentCredential: vi.fn(),
    UnauthorizedError,
    AgentCredentialError,
  };
});

vi.mock("@/lib/server/auth/requireSession", () => ({
  requireSession: auth.requireSession,
  requireSessionWithEmail: auth.requireSessionWithEmail,
  UnauthorizedError: auth.UnauthorizedError,
}));

vi.mock("@/lib/server/auth/requireAgentCredential", () => ({
  requireAgentCredential: auth.requireAgentCredential,
  AgentCredentialError: auth.AgentCredentialError,
}));

import { withAgentRoute } from "@/lib/server/api/routeHandler";

const { UnauthorizedError, AgentCredentialError } = auth;

function request(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/test", { headers });
}

beforeEach(() => {
  auth.requireSession.mockReset();
  auth.requireAgentCredential.mockReset();
});

describe("withAgentRoute", () => {
  it("authenticates a bearer credential with the route capability", async () => {
    auth.requireAgentCredential.mockResolvedValue({
      userId: "user-1",
      credentialId: "credential-1",
      capabilities: ["tailoring:execute"],
      requestId: "req-1",
    });

    const req = request({ Authorization: "Bearer tok" });
    const res = await withAgentRoute(
      req,
      "tailoring:execute",
      async ({ userId, requestId, authKind, credentialId }) =>
        NextResponse.json({ userId, requestId, authKind, credentialId }),
    );

    await expect(res.json()).resolves.toEqual({
      userId: "user-1",
      requestId: "req-1",
      authKind: "agent",
      credentialId: "credential-1",
    });
    expect(auth.requireSession).not.toHaveBeenCalled();
    expect(auth.requireAgentCredential).toHaveBeenCalledWith(req, "tailoring:execute");
  });

  it("falls back to the session when no Authorization header is present", async () => {
    auth.requireSession.mockResolvedValue({
      userId: "user-2",
      requestId: "req-2",
    });

    const res = await withAgentRoute(
      request(),
      "tailoring:execute",
      async ({ userId, authKind }) => NextResponse.json({ userId, authKind }),
    );

    await expect(res.json()).resolves.toEqual({
      userId: "user-2",
      authKind: "session",
    });
    expect(auth.requireAgentCredential).not.toHaveBeenCalled();
  });

  it("rejects an invalid or under-scoped bearer credential without a session fallback", async () => {
    // A caller that presented a token asked to be judged as a token holder.
    // Falling back to a cookie would let a revoked token keep working from a
    // browser, which defeats revocation.
    auth.requireAgentCredential.mockRejectedValue(
      new AgentCredentialError("Invalid credential or missing capability"),
    );

    const res = await withAgentRoute(
      request({ Authorization: "Bearer bad" }),
      "tailoring:control",
      async () => NextResponse.json({ ok: true }),
    );

    expect(res.status).toBe(401);
    expect(auth.requireSession).not.toHaveBeenCalled();
  });

  it("never treats an explicitly empty Authorization header as session auth", async () => {
    auth.requireAgentCredential.mockRejectedValue(
      new AgentCredentialError("Missing bearer credential"),
    );
    auth.requireSession.mockResolvedValue({
      userId: "signed-in-user",
      requestId: "req-session",
    });

    const res = await withAgentRoute(
      request({ Authorization: "" }),
      "tailoring:execute",
      async () => NextResponse.json({ ok: true }),
    );

    expect(res.status).toBe(401);
    expect(auth.requireAgentCredential).toHaveBeenCalledTimes(1);
    expect(auth.requireSession).not.toHaveBeenCalled();
  });

  it("rejects a missing session as 401", async () => {
    auth.requireSession.mockRejectedValue(new UnauthorizedError());

    const res = await withAgentRoute(
      request(),
      "tailoring:execute",
      async () => NextResponse.json({ ok: true }),
    );

    expect(res.status).toBe(401);
  });

  it("keeps the two identities from cross-contaminating", async () => {
    // Bearer first, then a plain-session call: neither leaks state into the
    // other, and each consults only its own authenticator.
    auth.requireAgentCredential.mockResolvedValue({
      userId: "runner-user",
      credentialId: "credential-1",
      capabilities: ["tailoring:execute"],
      requestId: "req-a",
    });
    auth.requireSession.mockResolvedValue({
      userId: "browser-user",
      requestId: "req-b",
    });

    const asRunner = await withAgentRoute(
      request({ Authorization: "Bearer tok" }),
      "tailoring:execute",
      async ({ userId }) => NextResponse.json({ userId }),
    );
    const asBrowser = await withAgentRoute(
      request(),
      "tailoring:execute",
      async ({ userId }) => NextResponse.json({ userId }),
    );

    await expect(asRunner.json()).resolves.toEqual({ userId: "runner-user" });
    await expect(asBrowser.json()).resolves.toEqual({ userId: "browser-user" });
    expect(auth.requireAgentCredential).toHaveBeenCalledTimes(1);
    expect(auth.requireSession).toHaveBeenCalledTimes(1);
  });

  it("validates params exactly like withSessionRoute", async () => {
    auth.requireSession.mockResolvedValue({
      userId: "user-2",
      requestId: "req-2",
    });

    const good = await withAgentRoute(
      request(),
      "tailoring:control",
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
      "tailoring:control",
      async () => NextResponse.json({ ok: true }),
      {
        params: Promise.resolve({ id: "not-a-uuid" }),
        schema: z.object({ id: z.string().uuid() }),
      },
    );
    expect(bad.status).toBe(400);
  });
});
