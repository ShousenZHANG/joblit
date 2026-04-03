import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "crypto";

const mockCreate = vi.fn();
const mockFindFirst = vi.fn();
const mockFindMany = vi.fn();
const mockUpdate = vi.fn();

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    extensionToken: {
      create: (...args: unknown[]) => mockCreate(...args),
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
      findMany: (...args: unknown[]) => mockFindMany(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
  },
}));

import {
  generateRawToken,
  hashToken,
  createExtensionToken,
  revokeExtensionToken,
  listExtensionTokens,
} from "./extensionToken";

describe("generateRawToken", () => {
  it("starts with jfext_ prefix", () => {
    const token = generateRawToken();
    expect(token.startsWith("jfext_")).toBe(true);
  });

  it("has sufficient length (prefix + 64 hex chars)", () => {
    const token = generateRawToken();
    expect(token.length).toBe(6 + 64); // "jfext_" + 32 bytes hex
  });

  it("generates unique tokens", () => {
    const t1 = generateRawToken();
    const t2 = generateRawToken();
    expect(t1).not.toBe(t2);
  });
});

describe("hashToken", () => {
  it("returns SHA-256 hex", () => {
    const result = hashToken("test");
    expect(result).toBe(createHash("sha256").update("test").digest("hex"));
  });
});

describe("createExtensionToken", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a token record and returns raw token", async () => {
    const now = new Date();
    mockCreate.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({
        id: "tok-1",
        ...data,
        createdAt: now,
      }),
    );

    const result = await createExtensionToken("user-1", "My Token", 30);

    expect(result.rawToken).toMatch(/^jfext_/);
    expect(result.name).toBe("My Token");
    expect(result.id).toBe("tok-1");
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());

    // Verify the hash stored is correct
    const callData = mockCreate.mock.calls[0][0].data;
    expect(callData.tokenHash).toBe(hashToken(result.rawToken));
    expect(callData.userId).toBe("user-1");
  });

  it("uses default 90-day expiry", async () => {
    mockCreate.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: "tok-2", ...data, createdAt: new Date() }),
    );

    const result = await createExtensionToken("user-1");
    const daysDiff = (result.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    expect(daysDiff).toBeGreaterThan(89);
    expect(daysDiff).toBeLessThanOrEqual(90);
  });
});

describe("revokeExtensionToken", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns true when token is found and revoked", async () => {
    mockFindFirst.mockResolvedValue({
      id: "tok-1",
      userId: "user-1",
      revokedAt: null,
    });
    mockUpdate.mockResolvedValue({});

    const result = await revokeExtensionToken("user-1", "tok-1");
    expect(result).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "tok-1" },
        data: { revokedAt: expect.any(Date) },
      }),
    );
  });

  it("returns false when token not found", async () => {
    mockFindFirst.mockResolvedValue(null);
    const result = await revokeExtensionToken("user-1", "tok-nonexistent");
    expect(result).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns false when token already revoked", async () => {
    mockFindFirst.mockResolvedValue({
      id: "tok-1",
      userId: "user-1",
      revokedAt: new Date(),
    });
    const result = await revokeExtensionToken("user-1", "tok-1");
    expect(result).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("scopes query to userId for security", async () => {
    mockFindFirst.mockResolvedValue(null);
    await revokeExtensionToken("user-1", "tok-1");
    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "tok-1", userId: "user-1" },
      }),
    );
  });
});

describe("listExtensionTokens", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns non-revoked tokens for user", async () => {
    const tokens = [
      { id: "tok-1", name: "Token 1", lastUsedAt: null, expiresAt: new Date(), createdAt: new Date() },
    ];
    mockFindMany.mockResolvedValue(tokens);

    const result = await listExtensionTokens("user-1");
    expect(result).toEqual(tokens);
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1", revokedAt: null },
      }),
    );
  });

  it("does not return tokenHash in select", async () => {
    mockFindMany.mockResolvedValue([]);
    await listExtensionTokens("user-1");
    const select = mockFindMany.mock.calls[0][0].select;
    expect(select.tokenHash).toBeUndefined();
  });
});
