import { beforeEach, describe, expect, it, vi } from "vitest";

const ingress = vi.hoisted(() => ({ withExtensionRoute: vi.fn() }));
const settingsStore = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("@/lib/server/extensionIngress/withExtensionRoute", () => ingress);
vi.mock("@/lib/server/prisma", () => ({
  prisma: { localAiSetting: settingsStore },
}));

import { GET, PUT } from "@/app/api/ext/local-ai/settings/route";

const USER_ID = "user-1";
const REQUEST_ID = "request-1";

function putRequest(body: unknown) {
  return new Request("http://localhost/api/ext/local-ai/settings", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer jfext_valid",
    },
    body: JSON.stringify(body),
  });
}

describe("extension local-ai settings api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ingress.withExtensionRoute.mockImplementation(
      async (
        _request: Request,
        _operation: string,
        handler: (context: {
          userId: string;
          requestId: string;
        }) => Promise<Response>,
      ) => handler({ userId: USER_ID, requestId: REQUEST_ID }),
    );
    settingsStore.upsert.mockResolvedValue({});
  });

  it("reads defaults through the centralized extension ingress", async () => {
    settingsStore.findUnique.mockResolvedValue(null);
    const request = new Request(
      "http://localhost/api/ext/local-ai/settings",
    );

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
    expect(ingress.withExtensionRoute).toHaveBeenCalledWith(
      request,
      "localAiSettings.read",
      expect.any(Function),
    );
    expect(settingsStore.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: USER_ID } }),
    );
  });

  it("stores and returns non-secret defaults for the ingress user", async () => {
    const putRequestValue = putRequest({
      hermesEndpoint: "http://127.0.0.1:8642",
      hermesProfile: "joblit-f1742d0bc521469b",
    });

    const putResponse = await PUT(putRequestValue);

    expect(putResponse.status).toBe(200);
    expect(ingress.withExtensionRoute).toHaveBeenCalledWith(
      putRequestValue,
      "localAiSettings.write",
      expect.any(Function),
    );
    expect(settingsStore.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: USER_ID },
        create: expect.objectContaining({
          userId: USER_ID,
          hermesEndpoint: "http://127.0.0.1:8642",
        }),
      }),
    );

    settingsStore.findUnique.mockResolvedValue({
      hermesEndpoint: "http://127.0.0.1:8642",
      hermesProfile: "joblit-f1742d0bc521469b",
      updatedAt: new Date("2026-07-18T00:00:00Z"),
    });
    const getResponse = await GET(
      new Request("http://localhost/api/ext/local-ai/settings"),
    );
    expect(await getResponse.json()).toMatchObject({
      hermesEndpoint: "http://127.0.0.1:8642",
      hermesProfile: "joblit-f1742d0bc521469b",
    });
  });

  it.each([
    [
      {
        hermesEndpoint: "http://evil.example:8642",
        hermesProfile: "joblit-f1742d0bc521469b",
      },
    ],
    [
      {
        hermesEndpoint: "http://127.0.0.1:8642",
        hermesProfile: "not-a-profile",
      },
    ],
    [
      {
        hermesEndpoint: "http://127.0.0.1:8642",
        hermesProfile: "joblit-f1742d0bc521469b",
        apiKey: "secret",
      },
    ],
  ])(
    "rejects non-loopback, malformed, or secret-carrying payloads",
    async (body) => {
      const response = await PUT(putRequest(body));

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json).toMatchObject({
        error: { code: "INVALID_BODY" },
        requestId: REQUEST_ID,
      });
      expect(settingsStore.upsert).not.toHaveBeenCalled();
    },
  );
});
