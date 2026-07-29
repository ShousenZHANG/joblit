import { beforeEach, describe, expect, it, vi } from "vitest";

const tokens = vi.hoisted(() => ({
  createExtensionToken: vi.fn(),
  revokeExtensionToken: vi.fn(),
  listExtensionTokens: vi.fn(),
}));
const ingress = vi.hoisted(() => ({ withExtensionRoute: vi.fn() }));

vi.mock("@/lib/server/extensionToken", () => tokens);
vi.mock("@/lib/server/extensionIngress/withExtensionRoute", () => ingress);

import { DELETE, GET, POST } from "@/app/api/ext/auth/token/route";

const USER_ID = "user-1";
const REQUEST_ID = "request-1";
const TOKEN_ID = "33333333-3333-4333-8333-333333333333";

function req(body?: unknown) {
  return new Request("http://localhost/api/ext/auth/token", {
    method: "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  ingress.withExtensionRoute.mockImplementation(
    async (
      _request: Request,
      _operation: string,
      handler: (context: { userId: string; requestId: string }) => Promise<Response>,
    ) => handler({ userId: USER_ID, requestId: REQUEST_ID }),
  );
});

describe("POST /api/ext/auth/token", () => {
  it("delegates token creation to the centralized extension ingress", async () => {
    tokens.createExtensionToken.mockResolvedValue({
      id: TOKEN_ID,
      token: "jbl_secret",
      expiresAt: null,
    });
    const request = req({ name: "Laptop", expiryDays: 30 });

    const res = await POST(request);

    expect(res.status).toBe(201);
    expect(ingress.withExtensionRoute).toHaveBeenCalledWith(
      request,
      "tokens.create",
      expect.any(Function),
    );
    expect(tokens.createExtensionToken).toHaveBeenCalledWith(
      USER_ID,
      "Laptop",
      30,
    );
  });

  it("rejects an invalid body with the ingress request id", async () => {
    const res = await POST(req({ expiryDays: 9999 }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: "INVALID_BODY" },
      requestId: REQUEST_ID,
    });
    expect(tokens.createExtensionToken).not.toHaveBeenCalled();
  });
});

describe("GET /api/ext/auth/token", () => {
  it("lists the ingress-authenticated user's tokens", async () => {
    tokens.listExtensionTokens.mockResolvedValue([{ id: TOKEN_ID }]);
    const request = new Request("http://localhost/api/ext/auth/token");

    const res = await GET(request);

    expect(res.status).toBe(200);
    expect(ingress.withExtensionRoute).toHaveBeenCalledWith(
      request,
      "tokens.list",
      expect.any(Function),
    );
    expect(tokens.listExtensionTokens).toHaveBeenCalledWith(USER_ID);
  });
});

describe("DELETE /api/ext/auth/token", () => {
  it("scopes revocation to the ingress-authenticated user", async () => {
    tokens.revokeExtensionToken.mockResolvedValue(true);
    const request = req({ tokenId: TOKEN_ID });

    const res = await DELETE(request);

    expect(res.status).toBe(200);
    expect(ingress.withExtensionRoute).toHaveBeenCalledWith(
      request,
      "tokens.revoke",
      expect.any(Function),
    );
    expect(tokens.revokeExtensionToken).toHaveBeenCalledWith(USER_ID, TOKEN_ID);
  });

  it("reports a missing token with the ingress request id", async () => {
    tokens.revokeExtensionToken.mockResolvedValue(false);

    const res = await DELETE(req({ tokenId: TOKEN_ID }));

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: "TOKEN_NOT_FOUND" },
      requestId: REQUEST_ID,
    });
  });

  it("rejects a body with no token id", async () => {
    const res = await DELETE(req({}));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: "INVALID_BODY" },
      requestId: REQUEST_ID,
    });
    expect(tokens.revokeExtensionToken).not.toHaveBeenCalled();
  });
});
