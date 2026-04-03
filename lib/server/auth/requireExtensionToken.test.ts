import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "crypto";

// Mock prisma
const mockFindFirst = vi.fn();
const mockUpdate = vi.fn();
vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    extensionToken: {
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
  },
}));

import {
  requireExtensionToken,
  ExtensionTokenError,
  hashToken,
} from "./requireExtensionToken";

function makeRequest(token?: string): Request {
  const headers = new Headers();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return new Request("https://example.com/api/ext/profile", { headers });
}

function makeValidToken() {
  const rawToken = "ext_test_token_abc123";
  const hash = createHash("sha256").update(rawToken).digest("hex");
  return {
    rawToken,
    dbRecord: {
      id: "token-id-1",
      userId: "user-id-1",
      tokenHash: hash,
      name: "Chrome Extension",
      expiresAt: new Date(Date.now() + 86400000), // +1 day
      revokedAt: null,
      lastUsedAt: null,
      createdAt: new Date(),
    },
  };
}

describe("hashToken", () => {
  it("returns SHA-256 hex digest", () => {
    const result = hashToken("hello");
    expect(result).toBe(
      createHash("sha256").update("hello").digest("hex"),
    );
    expect(result).toHaveLength(64);
  });

  it("is deterministic", () => {
    expect(hashToken("same")).toBe(hashToken("same"));
  });

  it("produces different hashes for different inputs", () => {
    expect(hashToken("a")).not.toBe(hashToken("b"));
  });
});

describe("requireExtensionToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when no Authorization header is present", async () => {
    const req = makeRequest();
    await expect(requireExtensionToken(req)).rejects.toThrow(
      ExtensionTokenError,
    );
    await expect(requireExtensionToken(req)).rejects.toThrow(
      "Missing or invalid Authorization header",
    );
  });

  it("throws when Authorization header is not Bearer", async () => {
    const headers = new Headers();
    headers.set("Authorization", "Basic abc123");
    const req = new Request("https://example.com", { headers });
    await expect(requireExtensionToken(req)).rejects.toThrow(
      ExtensionTokenError,
    );
  });

  it("throws when token is empty after Bearer", async () => {
    const req = makeRequest("");
    await expect(requireExtensionToken(req)).rejects.toThrow(
      ExtensionTokenError,
    );
  });

  it("throws when token not found in database", async () => {
    mockFindFirst.mockResolvedValue(null);
    const req = makeRequest("nonexistent_token");
    await expect(requireExtensionToken(req)).rejects.toThrow(
      ExtensionTokenError,
    );
    await expect(requireExtensionToken(req)).rejects.toThrow(
      "Invalid or expired token",
    );
  });

  it("throws when token is expired", async () => {
    const { rawToken, dbRecord } = makeValidToken();
    mockFindFirst.mockResolvedValue({
      ...dbRecord,
      expiresAt: new Date(Date.now() - 1000), // expired
    });
    const req = makeRequest(rawToken);
    await expect(requireExtensionToken(req)).rejects.toThrow(
      ExtensionTokenError,
    );
    await expect(requireExtensionToken(req)).rejects.toThrow(
      "Invalid or expired token",
    );
  });

  it("throws when token is revoked", async () => {
    const { rawToken, dbRecord } = makeValidToken();
    mockFindFirst.mockResolvedValue({
      ...dbRecord,
      revokedAt: new Date(), // revoked
    });
    const req = makeRequest(rawToken);
    await expect(requireExtensionToken(req)).rejects.toThrow(
      ExtensionTokenError,
    );
    await expect(requireExtensionToken(req)).rejects.toThrow(
      "Invalid or expired token",
    );
  });

  it("returns userId and tokenId for valid token", async () => {
    const { rawToken, dbRecord } = makeValidToken();
    mockFindFirst.mockResolvedValue(dbRecord);
    mockUpdate.mockResolvedValue(dbRecord);

    const req = makeRequest(rawToken);
    const ctx = await requireExtensionToken(req);

    expect(ctx.userId).toBe("user-id-1");
    expect(ctx.tokenId).toBe("token-id-1");
    expect(typeof ctx.requestId).toBe("string");
  });

  it("updates lastUsedAt on successful auth", async () => {
    const { rawToken, dbRecord } = makeValidToken();
    mockFindFirst.mockResolvedValue(dbRecord);
    mockUpdate.mockResolvedValue(dbRecord);

    const req = makeRequest(rawToken);
    await requireExtensionToken(req);

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "token-id-1" },
        data: { lastUsedAt: expect.any(Date) },
      }),
    );
  });

  it("queries database with hashed token", async () => {
    const { rawToken, dbRecord } = makeValidToken();
    mockFindFirst.mockResolvedValue(dbRecord);
    mockUpdate.mockResolvedValue(dbRecord);

    const req = makeRequest(rawToken);
    await requireExtensionToken(req);

    const expectedHash = hashToken(rawToken);
    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tokenHash: expectedHash },
      }),
    );
  });
});

describe("ExtensionTokenError", () => {
  it("has correct name and message", () => {
    const err = new ExtensionTokenError("test message");
    expect(err.name).toBe("ExtensionTokenError");
    expect(err.message).toBe("test message");
    expect(err instanceof Error).toBe(true);
  });
});
