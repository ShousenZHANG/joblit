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
  createAgentCredential: vi.fn(),
  revokeAgentCredential: vi.fn(),
  listAgentCredentials: vi.fn(),
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
    requireAgentCredential: vi.fn(),
    UnauthorizedError,
  };
});

vi.mock("@/lib/server/agentCredential", () => ({
  DEFAULT_AGENT_CAPABILITIES: [
    "fit:drain",
    "tailoring:execute",
    "tailoring:control",
  ],
  createAgentCredential: tokens.createAgentCredential,
  revokeAgentCredential: tokens.revokeAgentCredential,
  listAgentCredentials: tokens.listAgentCredentials,
}));
vi.mock("@/lib/server/auth/requireSession", () => ({
  requireSession: auth.requireSession,
  requireSessionWithEmail: auth.requireSessionWithEmail,
  UnauthorizedError: auth.UnauthorizedError,
}));
vi.mock("@/lib/server/auth/requireAgentCredential", () => ({
  requireAgentCredential: auth.requireAgentCredential,
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
    tokens.listAgentCredentials.mockResolvedValue([
      {
        id: TOKEN_ID,
        name: "Runner",
        audience: "joblit-agent",
        version: 1,
        capabilities: ["fit:drain"],
        lastUsedAt: null,
      },
    ]);

    const res = await GET();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      data: [
        {
          id: TOKEN_ID,
          name: "Runner",
          audience: "joblit-agent",
          version: 1,
          capabilities: ["fit:drain"],
          lastUsedAt: null,
        },
      ],
    });
    expect(tokens.listAgentCredentials).toHaveBeenCalledWith(USER_ID);
    expect(res.headers.get("Cache-Control")).toBe(
      "private, no-store, max-age=0",
    );
  });

  it("identifies the caller by session, never by a bearer token", async () => {
    tokens.listAgentCredentials.mockResolvedValue([]);

    await GET();

    expect(auth.requireSession).toHaveBeenCalledTimes(1);
    expect(auth.requireAgentCredential).not.toHaveBeenCalled();
  });

  it("returns 401 when there is no session", async () => {
    auth.requireSession.mockRejectedValue(new auth.UnauthorizedError());

    const res = await GET();

    expect(res.status).toBe(401);
    expect(tokens.listAgentCredentials).not.toHaveBeenCalled();
  });
});

describe("POST /api/agent-tokens", () => {
  it("creates a token with the caller's name and expiry", async () => {
    tokens.createAgentCredential.mockResolvedValue({
      id: TOKEN_ID,
      rawToken: `jfagent_v1_${"a".repeat(64)}`,
      expiresAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const res = await POST(req("POST", { name: "Laptop", expiryDays: 30 }));

    expect(res.status).toBe(201);
    expect(tokens.createAgentCredential).toHaveBeenCalledWith(
      USER_ID,
      "Laptop",
      30,
      ["fit:drain", "tailoring:execute", "tailoring:control"],
    );
    expect(res.headers.get("Cache-Control")).toBe(
      "private, no-store, max-age=0",
    );
  });

  it("names an unnamed token for the Runner, not the retired extension", async () => {
    tokens.createAgentCredential.mockResolvedValue({
      id: TOKEN_ID,
      rawToken: `jfagent_v1_${"b".repeat(64)}`,
      expiresAt: new Date(),
    });

    await POST(req("POST", {}));

    expect(tokens.createAgentCredential).toHaveBeenCalledWith(
      USER_ID,
      "Joblit Runner",
      90,
      ["fit:drain", "tailoring:execute", "tailoring:control"],
    );
  });

  it("can issue a least-privilege credential from the supported capability set", async () => {
    tokens.createAgentCredential.mockResolvedValue({
      id: TOKEN_ID,
      rawToken: `jfagent_v1_${"c".repeat(64)}`,
      expiresAt: new Date(),
    });

    const res = await POST(
      req("POST", {
        name: "Fit-only Runner",
        capabilities: ["fit:drain"],
      }),
    );

    expect(res.status).toBe(201);
    expect(tokens.createAgentCredential).toHaveBeenCalledWith(
      USER_ID,
      "Fit-only Runner",
      90,
      ["fit:drain"],
    );
  });

  it("rejects an invalid body without minting anything", async () => {
    const res = await POST(
      req("POST", {
        expiryDays: 9999,
        capabilities: ["extension:all"],
      }),
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: "INVALID_BODY" },
      requestId: REQUEST_ID,
    });
    expect(tokens.createAgentCredential).not.toHaveBeenCalled();
  });

  it("rejects unknown contract fields instead of silently discarding them", async () => {
    const res = await POST(req("POST", { legacyExtensionMode: true }));

    expect(res.status).toBe(400);
    expect(tokens.createAgentCredential).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/agent-tokens", () => {
  it("revokes a token the caller owns", async () => {
    tokens.revokeAgentCredential.mockResolvedValue(true);

    const res = await DELETE(req("DELETE", { tokenId: TOKEN_ID }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ data: { revoked: true } });
    expect(tokens.revokeAgentCredential).toHaveBeenCalledWith(USER_ID, TOKEN_ID);
  });

  it("reports a token that is already gone as 404, not as success", async () => {
    tokens.revokeAgentCredential.mockResolvedValue(false);

    const res = await DELETE(req("DELETE", { tokenId: TOKEN_ID }));

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: "TOKEN_NOT_FOUND" },
    });
  });

  it("requires a token id", async () => {
    const res = await DELETE(req("DELETE", {}));

    expect(res.status).toBe(400);
    expect(tokens.revokeAgentCredential).not.toHaveBeenCalled();
  });

  it("rejects unknown revocation fields", async () => {
    const res = await DELETE(
      req("DELETE", { tokenId: TOKEN_ID, revokeEveryToken: true }),
    );

    expect(res.status).toBe(400);
    expect(tokens.revokeAgentCredential).not.toHaveBeenCalled();
  });
});
