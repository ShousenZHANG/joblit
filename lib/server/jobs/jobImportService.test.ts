import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  transaction: vi.fn(),
  executeRaw: vi.fn(),
  deletedFindMany: vi.fn(),
  createMany: vi.fn(),
  operations: [] as string[],
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    $transaction: store.transaction,
  },
}));
vi.mock("@/lib/server/observability/errorReporter", () => ({
  reportError: vi.fn(),
}));

import {
  ImportJobItemSchema,
  importJobsForUser,
} from "./jobImportService";

describe("ImportJobItemSchema", () => {
  beforeEach(() => {
    store.operations.length = 0;
    store.transaction.mockReset().mockImplementation(async (callback) =>
      callback({
        $executeRaw: store.executeRaw,
        deletedJobUrl: { findMany: store.deletedFindMany },
        job: { createMany: store.createMany },
      }),
    );
    store.executeRaw.mockReset().mockImplementation(async () => {
      store.operations.push("lock");
      return 0;
    });
    store.deletedFindMany.mockReset().mockResolvedValue([]);
    store.deletedFindMany.mockImplementation(async () => {
      store.operations.push("tombstones");
      return [];
    });
    store.createMany.mockReset().mockImplementation(async ({ data }) => {
      store.operations.push("insert");
      return { count: data.length };
    });
  });

  it("normalizes bounded producer fields", () => {
    const parsed = ImportJobItemSchema.parse({
      jobUrl: " https://example.com/jobs/123 ",
      title: " Software Engineer ",
      company: " Acme ",
      market: "AU",
    });

    expect(parsed).toMatchObject({
      jobUrl: "https://example.com/jobs/123",
      title: "Software Engineer",
      company: "Acme",
      market: "AU",
    });
  });

  it("rejects unknown markets and oversized payload fields", () => {
    expect(
      ImportJobItemSchema.safeParse({
        jobUrl: "https://example.com/jobs/123",
        title: "Software Engineer",
        market: "MARS",
      }).success,
    ).toBe(false);
    // GLOBAL joined AU and CN when the aggregator sources landed.
    expect(
      ImportJobItemSchema.safeParse({
        jobUrl: "https://example.com/jobs/123",
        title: "Software Engineer",
        market: "GLOBAL",
      }).success,
    ).toBe(true);
    expect(
      ImportJobItemSchema.safeParse({
        jobUrl: "https://example.com/jobs/123",
        title: "x".repeat(241),
      }).success,
    ).toBe(false);
  });

  it("keeps distinct query-identified jobs and drops tracking parameters", async () => {
    const items = [
      ImportJobItemSchema.parse({
        jobUrl:
          "https://boards.greenhouse.io/acme/jobs?gh_jid=100&utm_source=a",
        title: "Backend Engineer",
      }),
      ImportJobItemSchema.parse({
        jobUrl:
          "https://boards.greenhouse.io/acme/jobs?gh_jid=200&utm_source=b",
        title: "Frontend Engineer",
      }),
    ];

    const result = await importJobsForUser({ userId: "user-1", items });

    expect(result).toEqual({ imported: 2, invalid: 0 });
    const data = store.createMany.mock.calls[0][0].data;
    expect(data.map((row: { jobUrl: string }) => row.jobUrl)).toEqual([
      "https://boards.greenhouse.io/acme/jobs?gh_jid=100",
      "https://boards.greenhouse.io/acme/jobs?gh_jid=200",
    ]);
    expect(store.operations).toEqual(["lock", "tombstones", "insert"]);
  });

  it("reads tombstones under the per-user lock before inserting", async () => {
    store.deletedFindMany.mockReset().mockImplementation(async () => {
      store.operations.push("tombstones");
      return [{ jobUrl: "https://example.com/jobs/blocked?utm_source=old" }];
    });
    const items = [
      ImportJobItemSchema.parse({
        jobUrl: "https://example.com/jobs/blocked?utm_source=new",
        title: "Blocked role",
      }),
      ImportJobItemSchema.parse({
        jobUrl: "https://example.com/jobs/allowed",
        title: "Allowed role",
      }),
    ];

    const result = await importJobsForUser({ userId: "user-1", items });

    expect(result).toEqual({ imported: 1, invalid: 0 });
    expect(store.operations).toEqual(["lock", "tombstones", "insert"]);
    expect(store.createMany.mock.calls[0]?.[0]?.data).toHaveLength(1);
    expect(store.createMany.mock.calls[0]?.[0]?.data[0].jobUrl).toBe(
      "https://example.com/jobs/allowed",
    );
  });

  it("records a clean posting risk for an ordinary aggregator row", async () => {
    const item = ImportJobItemSchema.parse({
      jobUrl: "https://www.linkedin.com/jobs/view/123",
      title: "AI Engineer",
      company: "Acme Robotics",
    });

    await importJobsForUser({ userId: "user-1", items: [item] });

    const row = store.createMany.mock.calls[0][0].data[0];
    expect(row.postingRisk).toBe(0);
    expect(row.postingRiskFlags).toEqual([]);
  });

  it("flags a shortener posting without dropping it", async () => {
    const item = ImportJobItemSchema.parse({
      jobUrl: "https://bit.ly/xyz",
      title: "AI Engineer",
      company: "Acme Robotics",
    });

    const result = await importJobsForUser({ userId: "user-1", items: [item] });

    // Still imported — risk is advisory, never a drop.
    expect(result.imported).toBe(1);
    const row = store.createMany.mock.calls[0][0].data[0];
    expect(row.postingRisk).toBe(40);
    expect(row.postingRiskFlags).toEqual([
      "suspicious_domain",
      "company_domain_mismatch",
    ]);
  });

  it("scores risk against the canonicalized url, not the raw input", async () => {
    const item = ImportJobItemSchema.parse({
      jobUrl: "https://bit.ly/xyz?utm_source=newsletter",
      title: "AI Engineer",
      company: "Acme Robotics",
    });

    await importJobsForUser({ userId: "user-1", items: [item] });

    const row = store.createMany.mock.calls[0][0].data[0];
    expect(row.jobUrl).toBe("https://bit.ly/xyz");
    expect(row.postingRiskFlags).toContain("suspicious_domain");
  });

  it("keys a repost at the same company onto the imported row", async () => {
    const items = [
      ImportJobItemSchema.parse({
        jobUrl: "https://www.linkedin.com/jobs/view/1",
        title: "Senior Backend Engineer (Remote)",
        company: "Acme Pty Ltd",
      }),
      ImportJobItemSchema.parse({
        jobUrl: "https://remoteok.com/remote-jobs/2",
        title: "Backend Engineer",
        company: "Acme",
      }),
    ];

    await importJobsForUser({ userId: "user-1", items });

    const rows = store.createMany.mock.calls[0][0].data;
    // Both rows import — the key is a hint, not a hard dedup.
    expect(rows).toHaveLength(2);
    expect(rows[0].companyRoleKey).toBe(rows[1].companyRoleKey);
    expect(rows[0].companyRoleKey).not.toBeNull();
  });

  it("leaves the role key null when there is no company to key on", async () => {
    const item = ImportJobItemSchema.parse({
      jobUrl: "https://example.com/jobs/1",
      title: "Backend Engineer",
    });

    await importJobsForUser({ userId: "user-1", items: [item] });

    expect(store.createMany.mock.calls[0][0].data[0].companyRoleKey).toBeNull();
  });

  it("persists the source and GLOBAL market on imported rows", async () => {
    const item = ImportJobItemSchema.parse({
      jobUrl: "https://remoteok.com/remote-jobs/1",
      title: "AI Engineer",
      market: "GLOBAL",
      source: "remoteok",
    });

    const result = await importJobsForUser({ userId: "user-1", items: [item] });

    expect(result.imported).toBe(1);
    expect(store.createMany.mock.calls[0][0].data[0]).toMatchObject({
      market: "GLOBAL",
      source: "remoteok",
    });
  });

  it("maps the JobSpy site field to the canonical source badge", async () => {
    const item = ImportJobItemSchema.parse({
      jobUrl: "https://www.linkedin.com/jobs/view/123",
      title: "Platform Engineer",
      site: "linkedin",
    });

    await importJobsForUser({ userId: "user-1", items: [item] });

    expect(store.createMany.mock.calls[0][0].data[0].source).toBe("jobspy");
  });

  it("stores a null source when the producer does not supply one", async () => {
    const item = ImportJobItemSchema.parse({
      jobUrl: "https://example.com/1",
      title: "Dev",
    });

    await importJobsForUser({ userId: "user-1", items: [item] });

    expect(store.createMany.mock.calls[0][0].data[0]).toMatchObject({
      market: "AU",
      source: null,
    });
  });

  it("keeps core imports available during an additive enrichment migration race", async () => {
    const migrationError = Object.assign(
      new Error('The column "Job.source" does not exist'),
      {
        code: "P2022",
        meta: { column: "Job.source" },
      },
    );
    store.createMany
      .mockImplementationOnce(async () => {
        store.operations.push("insert");
        throw migrationError;
      })
      .mockImplementationOnce(async () => {
        store.operations.push("insert");
        return { count: 1 };
      });
    const item = ImportJobItemSchema.parse({
      jobUrl: "https://remoteok.com/remote-jobs/1",
      title: "AI Engineer",
      market: "GLOBAL",
      source: "remoteok",
    });

    const result = await importJobsForUser({ userId: "user-1", items: [item] });

    expect(result.imported).toBe(1);
    expect(store.transaction).toHaveBeenCalledTimes(2);
    expect(store.executeRaw).toHaveBeenCalledTimes(2);
    expect(store.deletedFindMany).toHaveBeenCalledTimes(2);
    expect(store.createMany).toHaveBeenCalledTimes(2);
    expect(store.operations).toEqual([
      "lock",
      "tombstones",
      "insert",
      "lock",
      "tombstones",
      "insert",
    ]);
    const fallbackRow = store.createMany.mock.calls[1]?.[0]?.data[0];
    expect(fallbackRow).toMatchObject({
      title: "AI Engineer",
      market: "GLOBAL",
      status: "NEW",
    });
    expect(fallbackRow).not.toHaveProperty("source");
    expect(fallbackRow).not.toHaveProperty("postingRisk");
    expect(fallbackRow).not.toHaveProperty("companyRoleKey");
  });

  it("uses a non-empty snake-case value when camel-case input is blank", async () => {
    const item = ImportJobItemSchema.parse({
      jobUrl: "https://example.com/jobs/1",
      title: "Software Engineer",
      jobType: "",
      job_type: "fulltime",
    });

    await importJobsForUser({ userId: "user-1", items: [item] });

    expect(store.createMany.mock.calls[0][0].data[0].jobType).toBe("fulltime");
  });
});
