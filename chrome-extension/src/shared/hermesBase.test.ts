import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  HermesBaseValidationError,
  hermesBasePermissionPattern,
  isHermesProfileName,
  normalizeHermesBase,
  requestHermesBasePermission,
} from "./hermesBase";

describe("normalizeHermesBase", () => {
  it.each([
    ["http://127.0.0.1:8642", "http://127.0.0.1:8642"],
    ["http://localhost:9000/", "http://localhost:9000"],
    ["http://[::1]:65535", "http://[::1]:65535"],
  ])("accepts root loopback URL %s", (input, expected) => {
    expect(normalizeHermesBase(input)).toBe(expected);
  });

  it.each([
    "https://127.0.0.1:8642",
    "http://127.0.0.1",
    "http://0.0.0.0:8642",
    "http://192.168.1.10:8642",
    "http://localhost.example.com:8642",
    "http://user:key@127.0.0.1:8642",
    "http://127.0.0.1:8642/v1",
    "http://127.0.0.1:8642?key=x",
    "http://127.0.0.1:8642#x",
    "http://127.0.0.1:0",
    "http://127.0.0.1:65536",
  ])("rejects unsafe Hermes base %s", (input) => {
    expect(() => normalizeHermesBase(input)).toThrow(HermesBaseValidationError);
  });

  it("creates a Chrome host pattern without a port", () => {
    expect(hermesBasePermissionPattern("http://127.0.0.1:8642")).toBe("http://127.0.0.1/*");
  });
});

describe("requestHermesBasePermission", () => {
  beforeEach(() => {
    Object.assign(chrome, {
      permissions: {
        contains: vi.fn().mockResolvedValue(false),
        request: vi.fn().mockResolvedValue(true),
      },
    });
  });

  it("requests only the normalized loopback origin", async () => {
    await expect(requestHermesBasePermission("http://127.0.0.1:8642")).resolves.toBe(true);
    expect(chrome.permissions.request).toHaveBeenCalledWith({ origins: ["http://127.0.0.1/*"] });
  });
});

describe("isHermesProfileName", () => {
  it("accepts only opaque Joblit profile identifiers", () => {
    expect(isHermesProfileName("joblit-0123456789abcdef")).toBe(true);
    expect(isHermesProfileName("joblit")).toBe(false);
    expect(isHermesProfileName("joblit-user@example.com")).toBe(false);
  });
});
