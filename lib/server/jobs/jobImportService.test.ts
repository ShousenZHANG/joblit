import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  transaction: vi.fn(),
  executeRaw: vi.fn(),
  deletedFindMany: vi.fn(),
  createMany: vi.fn(),
  updateMany: vi.fn(),
  buildCooldownFilter: vi.fn(),
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
vi.mock("@/lib/server/jobs/applicationCooldownService", () => ({
  buildUserCooldownFilter: store.buildCooldownFilter,
  inferApplicationRoleFamily: (title: string) =>
    /backend/i.test(title) ? "backend" : null,
}));

import {
  ImportJobItemSchema,
  importJobsForUser,
  persistPreparedJobImport,
  prepareJobImportForUser,
} from "./jobImportService";

describe("ImportJobItemSchema", () => {
  beforeEach(() => {
    store.operations.length = 0;
    store.transaction.mockReset().mockImplementation(async (callback) =>
      callback({
        $executeRaw: store.executeRaw,
        deletedJobUrl: { findMany: store.deletedFindMany },
        job: {
          createMany: store.createMany,
          updateMany: store.updateMany,
        },
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
    store.updateMany.mockReset().mockResolvedValue({ count: 0 });
    store.buildCooldownFilter.mockReset().mockResolvedValue(() => true);
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
    expect(
      ImportJobItemSchema.safeParse({
        jobUrl: "https://example.com/jobs/123",
        title: "Software Engineer",
        market: "GLOBAL",
      }).success,
    ).toBe(false);
    expect(
      ImportJobItemSchema.safeParse({
        jobUrl: "https://example.com/jobs/123",
        title: "x".repeat(241),
      }).success,
    ).toBe(false);
  });

  it("revalidates internal producer rows at the persistence boundary", async () => {
    const unsafeInternalRow = {
      jobUrl: "https://example.com/jobs/oversized",
      title: "x".repeat(241),
      market: "AU",
    } as Parameters<typeof importJobsForUser>[0]["items"][number];

    const result = await importJobsForUser({
      userId: "user-1",
      items: [unsafeInternalRow],
    });

    expect(result).toEqual({ imported: 0, invalid: 1 });
    expect(store.transaction).not.toHaveBeenCalled();
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

  it("suppresses a recent same-company application before writing", async () => {
    store.buildCooldownFilter.mockResolvedValue(
      (candidate: { company: string; roleFamily: string | null }) =>
        candidate.company !== "Acme" || candidate.roleFamily !== "backend",
    );
    const item = ImportJobItemSchema.parse({
      jobUrl: "https://example.com/jobs/backend",
      title: "Backend Engineer",
      company: "Acme",
    });

    const result = await importJobsForUser({ userId: "user-1", items: [item] });

    expect(result).toEqual({ imported: 0, invalid: 0 });
    expect(store.transaction).not.toHaveBeenCalled();
  });

  it("fails open when cooldown history is temporarily unavailable", async () => {
    store.buildCooldownFilter.mockRejectedValue(
      new Error("ApplicationEvent table unavailable"),
    );
    const item = ImportJobItemSchema.parse({
      jobUrl: "https://example.com/jobs/available",
      title: "Backend Engineer",
      company: "Acme",
    });

    const result = await importJobsForUser({ userId: "user-1", items: [item] });

    expect(result.imported).toBe(1);
    expect(store.createMany).toHaveBeenCalledTimes(1);
  });

  it.each([
    "http://example.com/jobs/insecure",
    "https://127.0.0.1/private-job",
  ])("rejects an unsafe navigation URL at the shared import boundary: %s", async (jobUrl) => {
    const item = ImportJobItemSchema.parse({
      jobUrl,
      title: "Backend Engineer",
      company: "Acme",
    });

    const result = await importJobsForUser({ userId: "user-1", items: [item] });

    expect(result).toEqual({ imported: 0, invalid: 1 });
    expect(store.transaction).not.toHaveBeenCalled();
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
        jobUrl: "https://example.com/jobs/2",
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

  it("persists the source and AU market on imported rows", async () => {
    const item = ImportJobItemSchema.parse({
      jobUrl: "https://example.com/jobs/1",
      title: "AI Engineer",
      market: "AU",
      source: "jobspy",
    });

    const result = await importJobsForUser({ userId: "user-1", items: [item] });

    expect(result.imported).toBe(1);
    expect(store.createMany.mock.calls[0][0].data[0]).toMatchObject({
      market: "AU",
      source: "jobspy",
    });
  });

  it("writes description fingerprint and refreshes liveness for seen urls", async () => {
    const item = ImportJobItemSchema.parse({
      jobUrl: "https://example.com/jobs/1",
      title: "AI Engineer",
      description:
        "Design and operate reliable distributed machine learning services.",
      market: "AU",
      source: "jobspy",
    });

    await importJobsForUser({ userId: "user-1", items: [item] });

    expect(store.createMany.mock.calls[0][0].data[0]).toMatchObject({
      descriptionSimHash: expect.stringMatching(/^[0-9a-f]{16}$/),
      livenessStatus: "ACTIVE",
      livenessReason: "import_reachable",
      livenessCheckedAt: expect.any(Date),
      lastSeenAt: expect.any(Date),
    });
    expect(store.updateMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        jobUrl: { in: ["https://example.com/jobs/1"] },
        OR: [
          { livenessCheckedAt: null },
          { livenessCheckedAt: { lt: expect.any(Date) } },
        ],
      },
      data: {
        livenessStatus: "ACTIVE",
        livenessReason: "import_reachable",
        livenessCheckedAt: expect.any(Date),
        lastSeenAt: expect.any(Date),
      },
    });
  });

  it.each(["ACTIVE", "UNCERTAIN"] as const)(
    "does not let an older FetchRun overwrite a newer %s liveness snapshot",
    async (newerStatus) => {
      const olderAt = new Date("2026-07-20T00:00:00.000Z");
      const newerAt = new Date("2026-07-20T00:01:00.000Z");
      const item = ImportJobItemSchema.parse({
        jobUrl: "https://example.com/jobs/1",
        title: "AI Engineer",
        market: "AU",
        source: "jobspy",
      });
      const olderPrepared = await prepareJobImportForUser({
        userId: "user-1",
        items: [item],
      });
      olderPrepared.observedAt = olderAt;

      const row = {
        livenessStatus: newerStatus,
        livenessReason:
          newerStatus === "ACTIVE"
            ? "source_feed_reachable"
            : "missing_from_source_feed",
        livenessCheckedAt: newerAt,
        lastSeenAt: newerAt,
      };
      const expected = { ...row };
      store.createMany.mockResolvedValue({ count: 0 });
      store.updateMany.mockImplementation(async ({ where, data }) => {
        const cutoff = where.OR?.find(
          (condition: { livenessCheckedAt?: { lt?: Date } }) =>
            condition.livenessCheckedAt?.lt,
        )?.livenessCheckedAt?.lt;
        if (
          cutoff &&
          row.livenessCheckedAt &&
          row.livenessCheckedAt >= cutoff
        ) {
          return { count: 0 };
        }
        Object.assign(row, data);
        return { count: 1 };
      });
      const tx = {
        $executeRaw: store.executeRaw,
        deletedJobUrl: { findMany: store.deletedFindMany },
        job: {
          createMany: store.createMany,
          updateMany: store.updateMany,
        },
      } as unknown as Parameters<typeof persistPreparedJobImport>[0];

      await persistPreparedJobImport(tx, {
        userId: "user-1",
        prepared: olderPrepared,
        includeEnrichment: true,
      });

      expect(row).toEqual(expected);
      expect(store.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { livenessCheckedAt: null },
              { livenessCheckedAt: { lt: olderAt } },
            ],
          }),
        }),
      );
    },
  );

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
      jobUrl: "https://example.com/jobs/1",
      title: "AI Engineer",
      market: "AU",
      source: "jobspy",
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
      market: "AU",
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
