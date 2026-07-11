import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_API_BASE } from "./constants";
import {
  ApiBaseValidationError,
  apiBasePermissionPattern,
  normalizeApiBase,
  requestApiBasePermission,
  resolveStoredApiBase,
} from "./apiBase";

describe("normalizeApiBase", () => {
  it.each(["", "   ", null, undefined])(
    "uses the production default for an empty value (%s)",
    (value) => {
      expect(normalizeApiBase(value)).toBe(DEFAULT_API_BASE);
    },
  );

  it("normalizes HTTPS origins and preserves reverse-proxy paths", () => {
    expect(normalizeApiBase(`${DEFAULT_API_BASE}/`)).toBe(DEFAULT_API_BASE);
    expect(normalizeApiBase(" https://jobs.example.com/// ")).toBe(
      "https://jobs.example.com",
    );
    expect(normalizeApiBase("https://jobs.example.com/joblit/api///")).toBe(
      "https://jobs.example.com/joblit/api",
    );
  });

  it.each([
    ["http://localhost:3000/", "http://localhost:3000"],
    ["http://127.0.0.1:3000/api/", "http://127.0.0.1:3000/api"],
    ["http://[::1]:3000/", "http://[::1]:3000"],
  ])("allows loopback development URL %s", (input, expected) => {
    expect(normalizeApiBase(input)).toBe(expected);
  });

  it.each([
    "http://jobs.example.com",
    "ftp://jobs.example.com",
    "/api",
    "not a url",
    "https://user:secret@jobs.example.com",
    "https://jobs.example.com?token=secret",
    "https://jobs.example.com/?",
    "https://jobs.example.com#fragment",
    "https://jobs.example.com/#",
  ])("rejects an unsafe or ambiguous URL: %s", (value) => {
    expect(() => normalizeApiBase(value)).toThrow(ApiBaseValidationError);
  });

  it("builds an exact origin permission without leaking a proxy path", () => {
    expect(
      apiBasePermissionPattern("https://self-hosted.example.com/joblit/api"),
    ).toBe("https://self-hosted.example.com/*");
  });

  it.each([
    ["http://localhost:3000/api", "http://localhost/*"],
    ["https://jobs.example.com:8443/api", "https://jobs.example.com/*"],
  ])(
    "uses Chrome match-pattern host syntax for a URL with a port",
    (input, expected) => {
      expect(apiBasePermissionPattern(input)).toBe(expected);
    },
  );

  it("falls back to production when legacy storage is invalid", () => {
    expect(resolveStoredApiBase("http://attacker.example.com")).toBe(
      DEFAULT_API_BASE,
    );
    expect(resolveStoredApiBase("https://self-hosted.example.com/api/")).toBe(
      "https://self-hosted.example.com/api",
    );
  });
});

describe("requestApiBasePermission", () => {
  const contains = vi.fn();
  const request = vi.fn();

  beforeEach(() => {
    contains.mockReset();
    request.mockReset();
    Object.assign(chrome, {
      permissions: { contains, request },
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(chrome, "permissions");
  });

  it("reuses manifest access for the build-time default API", async () => {
    contains.mockResolvedValue(true);

    await expect(requestApiBasePermission(DEFAULT_API_BASE)).resolves.toBe(
      true,
    );
    expect(contains).toHaveBeenCalledWith({
      origins: [apiBasePermissionPattern(DEFAULT_API_BASE)],
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("requests exact access when a build-time default is not manifest-granted", async () => {
    contains.mockResolvedValue(false);
    request.mockResolvedValue(true);

    await expect(requestApiBasePermission(DEFAULT_API_BASE)).resolves.toBe(
      true,
    );
    expect(request).toHaveBeenCalledWith({
      origins: [apiBasePermissionPattern(DEFAULT_API_BASE)],
    });
  });

  it("reuses an already-granted exact origin", async () => {
    contains.mockResolvedValue(true);

    await expect(
      requestApiBasePermission("https://self-hosted.example.com/api"),
    ).resolves.toBe(true);

    expect(contains).toHaveBeenCalledWith({
      origins: ["https://self-hosted.example.com/*"],
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("requests only the normalized origin and returns the user's decision", async () => {
    contains.mockResolvedValue(false);
    request.mockResolvedValue(false);

    await expect(
      requestApiBasePermission("https://self-hosted.example.com/joblit/api"),
    ).resolves.toBe(false);

    expect(request).toHaveBeenCalledWith({
      origins: ["https://self-hosted.example.com/*"],
    });
  });
});
