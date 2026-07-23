import { beforeEach, describe, expect, it, vi } from "vitest";

const tokens = vi.hoisted(() => ({
  createExtensionToken: vi.fn(),
  revokeExtensionToken: vi.fn(),
  listExtensionTokens: vi.fn(),
}));
const limiter = vi.hoisted(() => ({ checkRateLimit: vi.fn() }));

vi.mock("@/lib/server/extensionToken", () => tokens);
vi.mock("@/lib/server/api/rateLimit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/api/rateLimit")>()),
  checkRateLimit: limiter.checkRateLimit,
}));
vi.mock("@/auth", () => ({ authOptions: {} }));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));

import { getServerSession } from "next-auth/next";
import { DELETE, GET, POST } from "@/app/api/ext/auth/token/route";

const USER_ID = "user-1";
const TOKEN_ID = "33333333-3333-4333-8333-333333333333";

function signedIn() {
  (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    user: { id: USER_ID },
  });
}

function req(body?: unknown) {
  return new Request("http://localhost/api/ext/auth/token", {
    method: "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  limiter.checkRateLimit.mockReturnValue({ allowed: true, remaining: 10, resetAt: 0 });
  (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
});

/**
 * This route mints the bearer token the Chrome extension authenticates with,
 * and had no tests at all. These cover the boundary rather than the storage:
 * that an anonymous caller gets nothing, that the rate limit runs before the
 * session lookup, and that every write is scoped to the session's user.
 */
describe("POST /api/ext/auth/token", () => {
  it("returns 401 without a session and mints nothing", async () => {
    const res = await POST(req({}));

    expect(res.status).toBe(401);
    expect(tokens.createExtensionToken).not.toHaveBeenCalled();
  });

  it("throttles anonymous callers before touching the session store", async () => {
    // The limit is keyed by request, not by user, precisely so it can run
    // first — moving it inside the session wrapper would let an unauthenticated
    // flood drive a database lookup per attempt.
    limiter.checkRateLimit.mockReturnValue({ allowed: false, remaining: 0, resetAt: 0 });

    const res = await POST(req({}));

    expect(res.status).toBe(429);
    expect(getServerSession).not.toHaveBeenCalled();
  });

  it("mints a token for the session's own user", async () => {
    signedIn();
    tokens.createExtensionToken.mockResolvedValue({
      id: TOKEN_ID,
      token: "jbl_secret",
      expiresAt: null,
    });

    const res = await POST(req({ name: "Laptop", expiryDays: 30 }));

    expect(res.status).toBe(201);
    expect(tokens.createExtensionToken).toHaveBeenCalledWith(USER_ID, "Laptop", 30);
  });

  it("rejects an invalid body without minting", async () => {
    signedIn();

    const res = await POST(req({ expiryDays: 9999 }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: "INVALID_BODY" },
    });
    expect(tokens.createExtensionToken).not.toHaveBeenCalled();
  });
});

describe("GET /api/ext/auth/token", () => {
  it("returns 401 without a session", async () => {
    const res = await GET(new Request("http://localhost/api/ext/auth/token"));
    expect(res.status).toBe(401);
    expect(tokens.listExtensionTokens).not.toHaveBeenCalled();
  });

  it("lists only the session user's tokens", async () => {
    signedIn();
    tokens.listExtensionTokens.mockResolvedValue([{ id: TOKEN_ID }]);

    const res = await GET(new Request("http://localhost/api/ext/auth/token"));

    expect(res.status).toBe(200);
    expect(tokens.listExtensionTokens).toHaveBeenCalledWith(USER_ID);
  });
});

describe("DELETE /api/ext/auth/token", () => {
  it("returns 401 without a session and revokes nothing", async () => {
    const res = await DELETE(req({ tokenId: TOKEN_ID }));

    expect(res.status).toBe(401);
    expect(tokens.revokeExtensionToken).not.toHaveBeenCalled();
  });

  it("scopes the revoke to the session user", async () => {
    signedIn();
    tokens.revokeExtensionToken.mockResolvedValue(true);

    const res = await DELETE(req({ tokenId: TOKEN_ID }));

    expect(res.status).toBe(200);
    // Not the caller-supplied id alone — another user's token id must not be
    // revocable by guessing it.
    expect(tokens.revokeExtensionToken).toHaveBeenCalledWith(USER_ID, TOKEN_ID);
  });

  it("reports a token that is not the caller's as not found", async () => {
    signedIn();
    tokens.revokeExtensionToken.mockResolvedValue(false);

    const res = await DELETE(req({ tokenId: TOKEN_ID }));

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: "TOKEN_NOT_FOUND" },
    });
  });

  it("rejects a body with no token id", async () => {
    signedIn();

    const res = await DELETE(req({}));

    expect(res.status).toBe(400);
    expect(tokens.revokeExtensionToken).not.toHaveBeenCalled();
  });
});
