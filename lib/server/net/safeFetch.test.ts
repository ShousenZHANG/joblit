import { describe, expect, it, vi } from "vitest";

import {
  assertPublicOutboundUrl,
  isPrivateOrReservedAddress,
  parseSafeOutboundUrl,
  safeOutboundFetch,
} from "./safeFetch";

const publicResolver = vi.fn(async () => [{ address: "1.1.1.1", family: 4 }]);

describe("safe outbound URL policy", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "100.64.1.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "224.0.0.1",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
  ])("blocks non-public address %s", (address) => {
    expect(isPrivateOrReservedAddress(address)).toBe(true);
  });

  it.each(["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"])(
    "allows public address %s",
    (address) => {
      expect(isPrivateOrReservedAddress(address)).toBe(false);
    },
  );

  it("requires https, forbids URL credentials, and enforces exact allowlists", () => {
    expect(() => parseSafeOutboundUrl("http://example.com")).toThrow(
      /HTTPS/i,
    );
    expect(() =>
      parseSafeOutboundUrl("https://user:pass@example.com"),
    ).toThrow(/credentials/i);
    expect(() =>
      parseSafeOutboundUrl("https://evil-example.com", {
        allowedHosts: ["example.com"],
        allowSubdomains: true,
      }),
    ).toThrow(/allowlisted/i);
    expect(
      parseSafeOutboundUrl("https://api.example.com", {
        allowedHosts: ["example.com"],
        allowSubdomains: true,
      }).hostname,
    ).toBe("api.example.com");
  });

  it("fails closed when any DNS answer is private", async () => {
    await expect(
      assertPublicOutboundUrl("https://example.com/path", {
        resolver: async () => [
          { address: "1.1.1.1" },
          { address: "127.0.0.1" },
        ],
      }),
    ).rejects.toMatchObject({ code: "PRIVATE_ADDRESS_FORBIDDEN" });
  });
});

describe("safeOutboundFetch", () => {
  it("validates every redirect and strips cross-origin credentials", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://cdn.example.com/result" },
        }),
      )
      .mockResolvedValueOnce(
        new Response('{"ok":true}', {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    const response = await safeOutboundFetch(
      "https://api.example.com/start",
      {
        headers: {
          authorization: "Bearer secret",
          "x-api-key": "secret",
          accept: "application/json",
        },
      },
      {
        allowedHosts: ["example.com"],
        allowSubdomains: true,
        resolver: publicResolver,
        fetchImpl,
      },
    );

    expect(await response.json()).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(publicResolver).toHaveBeenCalledTimes(2);
    const redirectedHeaders = new Headers(fetchImpl.mock.calls[1]?.[1]?.headers);
    expect(redirectedHeaders.get("authorization")).toBeNull();
    expect(redirectedHeaders.get("x-api-key")).toBeNull();
    expect(redirectedHeaders.get("accept")).toBe("application/json");
  });

  it("rejects a redirect to a private address before issuing the next request", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "https://127.0.0.1/admin" },
      }),
    );
    await expect(
      safeOutboundFetch(
        "https://example.com",
        {},
        { resolver: publicResolver, fetchImpl },
      ),
    ).rejects.toMatchObject({ code: "PRIVATE_ADDRESS_FORBIDDEN" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("enforces the streamed response body limit", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("x".repeat(32), {
        headers: { "content-length": "32" },
      }),
    );
    await expect(
      safeOutboundFetch(
        "https://example.com",
        {},
        {
          resolver: publicResolver,
          fetchImpl,
          maxResponseBytes: 16,
        },
      ),
    ).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
  });

  it("never places query secrets in validation errors", async () => {
    const error = await safeOutboundFetch(
      "https://127.0.0.1/path?key=top-secret",
      {},
      { fetchImpl: vi.fn<typeof fetch>() },
    ).catch((cause: unknown) => cause);
    expect(String(error)).not.toContain("top-secret");
  });
});
