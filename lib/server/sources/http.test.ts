import { afterEach, describe, expect, it, vi } from "vitest";
import { assertAllowedUrl, fetchSourceJson } from "./http";

describe("assertAllowedUrl", () => {
  it("accepts an https URL on an allowlisted host", () => {
    expect(() =>
      assertAllowedUrl("https://remoteok.com/api", ["remoteok.com"]),
    ).not.toThrow();
  });

  it("accepts a subdomain of an allowlisted host", () => {
    expect(() =>
      assertAllowedUrl("https://api.remoteok.com/v1", ["remoteok.com"]),
    ).not.toThrow();
  });

  it("rejects a host that merely ends with the allowlisted string", () => {
    expect(() =>
      assertAllowedUrl("https://evil-remoteok.com/api", ["remoteok.com"]),
    ).toThrow(/untrusted host/i);
  });

  it("rejects plain http", () => {
    expect(() =>
      assertAllowedUrl("http://remoteok.com/api", ["remoteok.com"]),
    ).toThrow(/https/i);
  });

  it("rejects an unparseable URL", () => {
    expect(() => assertAllowedUrl("not-a-url", ["remoteok.com"])).toThrow(
      /invalid url/i,
    );
  });

  it("rejects every URL when the allowlist is empty", () => {
    expect(() => assertAllowedUrl("https://remoteok.com/api", [])).toThrow(
      /untrusted host/i,
    );
  });
});

/** Typed stand-in for global fetch so `mock.calls[0][1]` stays a RequestInit. */
function makeFetchMock(body = "[]", status = 200) {
  return vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(body, { status }),
  );
}

describe("fetchSourceJson", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("refuses to follow redirects", async () => {
    const fetchMock = makeFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    await fetchSourceJson("https://remoteok.com/api", ["remoteok.com"]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.redirect).toBe("error");
  });

  it("sends an honest bot user agent", async () => {
    const fetchMock = makeFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    await fetchSourceJson("https://remoteok.com/api", ["remoteok.com"]);

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["user-agent"]).toMatch(/JoblitBot/);
  });

  it("throws on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock("nope", 503),
    );

    await expect(
      fetchSourceJson("https://remoteok.com/api", ["remoteok.com"]),
    ).rejects.toThrow(/503/);
  });

  it("never issues a request for a disallowed host", async () => {
    const fetchMock = makeFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchSourceJson("https://attacker.example/api", ["remoteok.com"]),
    ).rejects.toThrow(/untrusted host/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the decoded payload", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock(JSON.stringify([{ a: 1 }])),
    );

    const payload = await fetchSourceJson("https://remoteok.com/api", [
      "remoteok.com",
    ]);

    expect(payload).toEqual([{ a: 1 }]);
  });
});
