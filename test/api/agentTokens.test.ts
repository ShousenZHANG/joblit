import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The agent token API is the Runner's front door. It replaced
 * `/api/ext/auth/token`, which lived inside the extension ingress and was
 * removed with it (ADR-0014).
 *
 * Session-only by construction: minting a token from a token would let a
 * leaked credential renew itself past revocation, so `withSessionRoute` — not
 * `withAgentRoute` — guards these three handlers.
 */

const tokens = vi.hoisted(() => ({
  createExtensionToken: vi.fn(),
  revokeExtensionToken: vi.fn(),
  listExtensionTokens: vi.fn(),
}));

// Only auth is mocked: the real `withSessionRoute` runs, so these tests prove
// the route sits on the session seam rather than trusting a stubbed wrapper.
// Importing the real module would drag auth.ts and prisma in with it.
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
    requireExtensionToken: vi.fn(),
    UnauthorizedError,
  };
});

vi.mock("@/lib/server/extensionToken", () => tokens);
vi.mock("@/lib/server/auth/requireSession", () => ({
  requireSession: auth.requireSession,
  requireSessionWithEmail: auth.requireSessionWithEmail,
  UnauthorizedError: auth.UnauthorizedError,
}));
vi.mock("@/lib/server/auth/requireExtensionToken", () => ({
  requireExtensionToken: auth.requireExtensionToken,
}));

import { DELETE, GET, POST } from "@/app/api/agent-tokens/route";

const USER_ID = "user-1";
const REQUEST_ID = "request-1";
const TOKEN_ID = "33333333-3333-4333-8333-333333333333";

function req(method: string, body?: unknown) {
  return new Request("http://localhost/api/agent-tokens", {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.requireSession.mockResolvedValue({
    userId: USER_ID,
    requestId: REQUEST_ID,
  });
});

describe("GET /api/agent-tokens", () => {
  it("lists the caller's active tokens", async () => {
    tokens.listExtensionTokens.mockResolvedValue([
      { id: TOKEN_ID, name: "Runner", lastUsedAt: null },
    ]);

    const res = await GET();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      data: [{ id: TOKEN_ID, name: "Runner", lastUsedAt: null }],
    });
    expect(tokens.listExtensionTokens).toHaveBeenCalledWith(USER_ID);
  });

  it("identifies the caller by session, never by a bearer token", async () => {
    tokens.listExtensionTokens.mockResolvedValue([]);

    await GET();

    expect(auth.requireSession).toHaveBeenCalledTimes(1);
    expect(auth.requireExtensionToken).not.toHaveBeenCalled();
  });

  it("returns 401 when there is no session", async () => {
    auth.requireSession.mockRejectedValue(new auth.UnauthorizedError());

    const res = await GET();

    expect(res.status).toBe(401);
    expect(tokens.listExtensionTokens).not.toHaveBeenCalled();
  });
});

describe("POST /api/agent-tokens", () => {
  it("creates a token with the caller's name and expiry", async () => {
    tokens.createExtensionToken.mockResolvedValue({
      id: TOKEN_ID,
      rawToken: "jfext_secret",
      expiresAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const res = await POST(req("POST", { name: "Laptop", expiryDays: 30 }));

    expect(res.status).toBe(201);
    expect(tokens.createExtensionToken).toHaveBeenCalledWith(USER_ID, "Laptop", 30);
  });

  it("names an unnamed token for the Runner, not the retired extension", async () => {
    tokens.createExtensionToken.mockResolvedValue({
      id: TOKEN_ID,
      rawToken: "jfext_secret",
      expiresAt: new Date(),
    });

    await POST(req("POST", {}));

    expect(tokens.createExtensionToken).toHaveBeenCalledWith(
      USER_ID,
      "Joblit Runner",
      90,
    );
  });

  it("rejects an invalid body without minting anything", async () => {
    const res = await POST(req("POST", { expiryDays: 9999 }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: "INVALID_BODY" },
      requestId: REQUEST_ID,
    });
    expect(tokens.createExtensionToken).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/agent-tokens", () => {
  it("revokes a token the caller owns", async () => {
    tokens.revokeExtensionToken.mockResolvedValue(true);

    const res = await DELETE(req("DELETE", { tokenId: TOKEN_ID }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ data: { revoked: true } });
    expect(tokens.revokeExtensionToken).toHaveBeenCalledWith(USER_ID, TOKEN_ID);
  });

  it("reports a token that is already gone as 404, not as success", async () => {
    tokens.revokeExtensionToken.mockResolvedValue(false);

    const res = await DELETE(req("DELETE", { tokenId: TOKEN_ID }));

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: "TOKEN_NOT_FOUND" },
    });
  });

  it("requires a token id", async () => {
    const res = await DELETE(req("DELETE", {}));

    expect(res.status).toBe(400);
    expect(tokens.revokeExtensionToken).not.toHaveBeenCalled();
  });
});
