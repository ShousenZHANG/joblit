import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError, fetchJson } from "./fetchJson";

describe("fetchJson", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
    return new Response(JSON.stringify(body), {
      ...init,
      headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
  }

  it("returns parsed body on 2xx", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "1" }));
    const result = await fetchJson<undefined>("/api/x");
    expect(result).toEqual({ id: "1" });
  });

  it("validates against Zod schema when provided", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "1", name: "alice" }));
    const schema = z.object({ id: z.string(), name: z.string() });
    const result = await fetchJson("/api/x", { schema });
    expect(result.name).toBe("alice");
  });

  it("throws ApiError on non-2xx with envelope error.message", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { message: "Validation failed" } }, { status: 400 }),
    );
    await expect(fetchJson("/api/x")).rejects.toMatchObject({
      name: "ApiError",
      status: 400,
      message: "Validation failed",
    });
  });

  it("throws ApiError on non-2xx with legacy string error", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "Not found" }, { status: 404 }),
    );
    await expect(fetchJson("/api/x")).rejects.toMatchObject({
      status: 404,
      message: "Not found",
    });
  });

  it("falls back when error payload missing", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 500 }));
    await expect(
      fetchJson("/api/x", { fallbackError: "Server error" }),
    ).rejects.toMatchObject({ message: "Server error" });
  });

  it("throws ApiError when response shape fails schema", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ wrong: true }));
    const schema = z.object({ id: z.string() });
    await expect(fetchJson("/api/x", { schema })).rejects.toBeInstanceOf(ApiError);
  });

  it("auto-sets Content-Type when body present", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await fetchJson("/api/x", { method: "POST", body: JSON.stringify({}) });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
  });

  it("respects caller-provided Content-Type", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await fetchJson("/api/x", {
      method: "POST",
      body: "raw",
      headers: { "Content-Type": "text/plain" },
    });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("Content-Type")).toBe("text/plain");
  });
});
