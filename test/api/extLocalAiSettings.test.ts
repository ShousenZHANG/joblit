import { beforeEach, describe, expect, it, vi } from "vitest";

const extensionAuth = vi.hoisted(() => ({ requireToken: vi.fn() }));
const settingsStore = vi.hoisted(() => ({ findUnique: vi.fn(), upsert: vi.fn() }));

vi.mock("@/lib/server/auth/requireExtensionToken", () => {
  class ExtensionTokenError extends Error {}
  return { ExtensionTokenError, requireExtensionToken: extensionAuth.requireToken };
});

vi.mock("@/lib/server/prisma", () => ({
  prisma: { localAiSetting: settingsStore },
}));

import { GET, PUT } from "@/app/api/ext/local-ai/settings/route";
import { ExtensionTokenError } from "@/lib/server/auth/requireExtensionToken";

function putRequest(body: unknown) {
  return new Request("http://localhost/api/ext/local-ai/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: "Bearer jfext_valid" },
    body: JSON.stringify(body),
  });
}

describe("extension local-ai settings api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    extensionAuth.requireToken.mockResolvedValue({
      userId: "user-1",
      tokenId: "token-1",
      requestId: "req-1",
    });
    settingsStore.upsert.mockResolvedValue({});
  });

  it("returns null when no defaults are stored", async () => {
    settingsStore.findUnique.mockResolvedValue(null);
    const response = await GET(new Request("http://localhost/api/ext/local-ai/settings"));
    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
  });

  it("stores and returns non-secret defaults", async () => {
    const putResponse = await PUT(
      putRequest({ hermesEndpoint: "http://127.0.0.1:8642", hermesProfile: "joblit-f1742d0bc521469b" }),
    );
    expect(putResponse.status).toBe(200);
    expect(settingsStore.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1" },
        create: expect.objectContaining({ hermesEndpoint: "http://127.0.0.1:8642" }),
      }),
    );

    settingsStore.findUnique.mockResolvedValue({
      hermesEndpoint: "http://127.0.0.1:8642",
      hermesProfile: "joblit-f1742d0bc521469b",
      updatedAt: new Date("2026-07-18T00:00:00Z"),
    });
    const getResponse = await GET(new Request("http://localhost/api/ext/local-ai/settings"));
    expect(await getResponse.json()).toMatchObject({
      hermesEndpoint: "http://127.0.0.1:8642",
      hermesProfile: "joblit-f1742d0bc521469b",
    });
  });

  it.each([
    [{ hermesEndpoint: "http://evil.example:8642", hermesProfile: "joblit-f1742d0bc521469b" }],
    [{ hermesEndpoint: "http://127.0.0.1:8642", hermesProfile: "not-a-profile" }],
    [{ hermesEndpoint: "http://127.0.0.1:8642", hermesProfile: "joblit-f1742d0bc521469b", apiKey: "secret" }],
  ])("rejects non-loopback, malformed, or secret-carrying payloads", async (body) => {
    const response = await PUT(putRequest(body));
    expect(response.status).toBe(400);
    expect(settingsStore.upsert).not.toHaveBeenCalled();
  });

  it("rejects an invalid extension token", async () => {
    extensionAuth.requireToken.mockRejectedValueOnce(new ExtensionTokenError("bad"));
    const response = await GET(new Request("http://localhost/api/ext/local-ai/settings"));
    expect(response.status).toBe(401);
  });
});
