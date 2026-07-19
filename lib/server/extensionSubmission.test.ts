import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreate = vi.fn();
const mockJobFindFirst = vi.fn();
const mockFindMany = vi.fn();
const mockCount = vi.fn();
const mockUpsert = vi.fn();
const mockDeleteMany = vi.fn();
const mockUpdateMany = vi.fn();

// Separate mocks so fieldMappingRule.findMany and formSubmission.findMany don't collide
const mockRuleFindMany = vi.fn();

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    job: {
      findFirst: (...args: unknown[]) => mockJobFindFirst(...args),
    },
    formSubmission: {
      create: (...args: unknown[]) => mockCreate(...args),
      findMany: (...args: unknown[]) => mockFindMany(...args),
      count: (...args: unknown[]) => mockCount(...args),
    },
    fieldMappingRule: {
      upsert: (...args: unknown[]) => mockUpsert(...args),
      findMany: (...args: unknown[]) => mockRuleFindMany(...args),
      deleteMany: (...args: unknown[]) => mockDeleteMany(...args),
      updateMany: (...args: unknown[]) => mockUpdateMany(...args),
    },
  },
}));

import {
  createFormSubmission,
  listFormSubmissions,
  upsertFieldMappingRule,
  listFieldMappingRules,
  deleteFieldMappingRule,
  updateFieldMappingRule,
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

  it("links a submission only to a job owned by the same user", async () => {
    const jobId = "11111111-1111-4111-8111-111111111111";
    mockJobFindFirst.mockResolvedValue({ id: jobId });
    mockCreate.mockResolvedValue({ id: "sub-3" });

    await createFormSubmission({
      userId: "user-1",
      jobId,
      pageUrl: "https://example.com/apply",
      pageDomain: "example.com",
      formSignature: "owned-job",
      fieldValues: {},
      fieldMappings: {},
    });

    expect(mockJobFindFirst).toHaveBeenCalledWith({
      where: { id: jobId, userId: "user-1" },
      select: { id: true },
    });
    expect(mockCreate.mock.calls[0][0].data.jobId).toBe(jobId);
  });

  it("rejects a job owned by another user", async () => {
    mockJobFindFirst.mockResolvedValue(null);

    await expect(
      createFormSubmission({
        userId: "user-1",
        jobId: "22222222-2222-4222-8222-222222222222",
        pageUrl: "https://example.com/apply",
        pageDomain: "example.com",
        formSignature: "foreign-job",
        fieldValues: {},
        fieldMappings: {},
      }),
    ).rejects.toMatchObject({ name: "SubmissionJobAccessError" });
    expect(mockCreate).not.toHaveBeenCalled();
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

  it("returns ALL rules when no filters (web dashboard)", async () => {
    const rules = [{ id: "rule-1" }];
    mockRuleFindMany.mockResolvedValue(rules);

    const result = await listFieldMappingRules({ userId: "user-1" });

    expect(result).toEqual(rules);
    expect(mockRuleFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1" },
      }),
    );
  });

  it("includes global + ATS-level rules when filtering by atsProvider", async () => {
    mockRuleFindMany.mockResolvedValue([]);

    await listFieldMappingRules({ userId: "user-1", atsProvider: "greenhouse" });

    const callArg = mockRuleFindMany.mock.calls[0][0];
    expect(callArg.where.userId).toBe("user-1");
    expect(callArg.where.OR).toEqual([
      { atsProvider: "", pageDomain: "" },
      { atsProvider: "greenhouse", pageDomain: "" },
    ]);
  });

  it("includes global + ATS + site rules when both filters provided", async () => {
    mockRuleFindMany.mockResolvedValue([]);

    await listFieldMappingRules({
      userId: "user-1",
      atsProvider: "greenhouse",
      pageDomain: "boards.greenhouse.io",
    });

    const callArg = mockRuleFindMany.mock.calls[0][0];
    expect(callArg.where.OR).toEqual([
      { atsProvider: "", pageDomain: "" },
      { atsProvider: "greenhouse", pageDomain: "" },
      { atsProvider: "greenhouse", pageDomain: "boards.greenhouse.io" },
    ]);
  });
});

describe("upsertFieldMappingRule — normalization", () => {
  beforeEach(() => vi.clearAllMocks());

  it("normalizes undefined atsProvider/pageDomain to empty string", async () => {
    mockUpsert.mockResolvedValue({ id: "rule-1" });

    await upsertFieldMappingRule({
      userId: "user-1",
      fieldSelector: "#email",
      profilePath: "email",
    });

    const callArg = mockUpsert.mock.calls[0][0];
    // where and create should both use "" (not null or undefined)
    expect(callArg.where.userId_fieldSelector_atsProvider_pageDomain.atsProvider).toBe("");
    expect(callArg.where.userId_fieldSelector_atsProvider_pageDomain.pageDomain).toBe("");
    expect(callArg.create.atsProvider).toBe("");
    expect(callArg.create.pageDomain).toBe("");
  });

  it("normalizes empty string atsProvider consistently", async () => {
    mockUpsert.mockResolvedValue({ id: "rule-2" });

    await upsertFieldMappingRule({
      userId: "user-1",
      fieldSelector: "#name",
      profilePath: "fullName",
      atsProvider: "",
      pageDomain: "",
    });

    const callArg = mockUpsert.mock.calls[0][0];
    expect(callArg.where.userId_fieldSelector_atsProvider_pageDomain.atsProvider).toBe("");
    expect(callArg.create.atsProvider).toBe("");
  });

  it("trims whitespace from atsProvider and pageDomain", async () => {
    mockUpsert.mockResolvedValue({ id: "rule-3" });

    await upsertFieldMappingRule({
      userId: "user-1",
      fieldSelector: "#phone",
      profilePath: "phone",
      atsProvider: "  greenhouse  ",
      pageDomain: "  boards.greenhouse.io  ",
    });

    const callArg = mockUpsert.mock.calls[0][0];
    expect(callArg.where.userId_fieldSelector_atsProvider_pageDomain.atsProvider).toBe("greenhouse");
    expect(callArg.where.userId_fieldSelector_atsProvider_pageDomain.pageDomain).toBe("boards.greenhouse.io");
    expect(callArg.create.atsProvider).toBe("greenhouse");
    expect(callArg.create.pageDomain).toBe("boards.greenhouse.io");
  });
});

describe("deleteFieldMappingRule", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deletes by id and userId", async () => {
    mockDeleteMany.mockResolvedValue({ count: 1 });
    await deleteFieldMappingRule("user-1", "rule-1");
    expect(mockDeleteMany).toHaveBeenCalledWith({
      where: { id: "rule-1", userId: "user-1" },
    });
  });
});

describe("updateFieldMappingRule", () => {
  beforeEach(() => vi.clearAllMocks());

  it("updates by id and userId with data", async () => {
    mockUpdateMany.mockResolvedValue({ count: 1 });
    await updateFieldMappingRule("user-1", "rule-1", {
      profilePath: "email",
      staticValue: "new@ex.com",
    });
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: "rule-1", userId: "user-1" },
      data: { profilePath: "email", staticValue: "new@ex.com" },
    });
  });
});
