import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreate = vi.fn();
const mockFindMany = vi.fn();
const mockCount = vi.fn();
const mockUpsert = vi.fn();

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    formSubmission: {
      create: (...args: unknown[]) => mockCreate(...args),
      findMany: (...args: unknown[]) => mockFindMany(...args),
      count: (...args: unknown[]) => mockCount(...args),
    },
    fieldMappingRule: {
      upsert: (...args: unknown[]) => mockUpsert(...args),
      findMany: (...args: unknown[]) => mockFindMany(...args),
    },
  },
}));

import {
  createFormSubmission,
  listFormSubmissions,
  upsertFieldMappingRule,
  listFieldMappingRules,
} from "./extensionSubmission";

describe("createFormSubmission", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a submission record", async () => {
    const input = {
      userId: "user-1",
      pageUrl: "https://boards.greenhouse.io/acme/jobs/123",
      pageDomain: "boards.greenhouse.io",
      atsProvider: "greenhouse",
      formSignature: "abc123",
      fieldValues: { email: "john@example.com", name: "John" },
      fieldMappings: { email: { source: "profile", profilePath: "email", confidence: 0.9 } },
    };

    mockCreate.mockResolvedValue({ id: "sub-1", ...input });
    const result = await createFormSubmission(input);

    expect(result.id).toBe("sub-1");
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-1",
          pageDomain: "boards.greenhouse.io",
          formSignature: "abc123",
        }),
      }),
    );
  });

  it("handles optional jobId", async () => {
    mockCreate.mockResolvedValue({ id: "sub-2" });
    await createFormSubmission({
      userId: "user-1",
      pageUrl: "https://example.com/apply",
      pageDomain: "example.com",
      formSignature: "xyz",
      fieldValues: {},
      fieldMappings: {},
    });

    expect(mockCreate.mock.calls[0][0].data.jobId).toBeNull();
  });
});

describe("listFormSubmissions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns paginated submissions", async () => {
    const items = [{ id: "sub-1" }, { id: "sub-2" }];
    mockFindMany.mockResolvedValue(items);
    mockCount.mockResolvedValue(5);

    const result = await listFormSubmissions({ userId: "user-1", limit: 2, offset: 0 });

    expect(result.items).toEqual(items);
    expect(result.total).toBe(5);
  });

  it("filters by pageDomain and atsProvider", async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);

    await listFormSubmissions({
      userId: "user-1",
      pageDomain: "boards.greenhouse.io",
      atsProvider: "greenhouse",
    });

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          pageDomain: "boards.greenhouse.io",
          atsProvider: "greenhouse",
        }),
      }),
    );
  });

  it("filters by formSignature for exact match", async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);

    await listFormSubmissions({ userId: "user-1", formSignature: "sig-123" });

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ formSignature: "sig-123" }),
      }),
    );
  });
});

describe("upsertFieldMappingRule", () => {
  beforeEach(() => vi.clearAllMocks());

  it("upserts a mapping rule", async () => {
    mockUpsert.mockResolvedValue({ id: "rule-1" });

    await upsertFieldMappingRule({
      userId: "user-1",
      fieldSelector: "#email",
      profilePath: "email",
      source: "user",
    });

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId_fieldSelector_atsProvider_pageDomain: expect.objectContaining({
            userId: "user-1",
            fieldSelector: "#email",
          }),
        }),
        create: expect.objectContaining({
          profilePath: "email",
          source: "user",
        }),
        update: expect.objectContaining({
          profilePath: "email",
          useCount: { increment: 1 },
        }),
      }),
    );
  });
});

describe("listFieldMappingRules", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns rules for user", async () => {
    const rules = [{ id: "rule-1", fieldSelector: "#email", profilePath: "email" }];
    mockFindMany.mockResolvedValue(rules);

    const result = await listFieldMappingRules({ userId: "user-1" });
    expect(result).toEqual(rules);
  });

  it("filters by atsProvider", async () => {
    mockFindMany.mockResolvedValue([]);

    await listFieldMappingRules({ userId: "user-1", atsProvider: "greenhouse" });

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ atsProvider: "greenhouse" }),
      }),
    );
  });
});
