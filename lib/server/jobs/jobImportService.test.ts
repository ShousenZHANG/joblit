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
