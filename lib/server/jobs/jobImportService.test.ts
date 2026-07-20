import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  deletedFindMany: vi.fn(),
  createMany: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    deletedJobUrl: { findMany: store.deletedFindMany },
    job: { createMany: store.createMany },
  },
}));

import {
  ImportJobItemSchema,
  importJobsForUser,
} from "./jobImportService";

describe("ImportJobItemSchema", () => {
  beforeEach(() => {
    store.deletedFindMany.mockReset().mockResolvedValue([]);
    store.createMany.mockReset().mockImplementation(async ({ data }) => ({
      count: data.length,
    }));
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
