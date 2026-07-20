import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  updateMany: vi.fn(),
  findFirst: vi.fn(),
  executeRawLock: vi.fn(),
  runCnFetch: vi.fn(),
  importJobs: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    $transaction: async (
      action: (tx: {
        fetchRun: {
          findFirst: typeof store.findFirst;
          updateMany: typeof store.updateMany;
        };
        $executeRaw: typeof store.executeRawLock;
      }) => Promise<unknown>,
    ) =>
      action({
        fetchRun: {
          findFirst: store.findFirst,
          updateMany: store.updateMany,
        },
        $executeRaw: store.executeRawLock,
      }),
  },
}));
vi.mock("./runCnFetch", () => ({ runCnFetch: store.runCnFetch }));
vi.mock(
  "@/lib/server/jobs/jobImportService",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/lib/server/jobs/jobImportService")
    >()),
    importJobsForUser: store.importJobs,
  }),
);

import { processCnFetchRun } from "./processFetchRun";

beforeEach(() => {
  vi.clearAllMocks();
  store.findFirst.mockResolvedValue({ id: "run-1" });
  store.updateMany.mockResolvedValue({ count: 1 });
  store.executeRawLock.mockResolvedValue(1);
  store.importJobs.mockResolvedValue({ imported: 1, invalid: 0 });
});

describe("processCnFetchRun", () => {
  it("routes normalized rows through the canonical shared importer", async () => {
    const row = {
      jobUrl: "https://www.nowcoder.com/jobs/detail/1",
      title: "Java 后端工程师",
      company: "Acme",
      location: "上海",
      jobType: "fulltime",
      jobLevel: "junior",
      description: "Java Spring",
      listingDate: "2026-07-20T00:00:00.000Z",
      market: "CN" as const,
      source: "nowcoder" as const,
    };
    store.runCnFetch.mockResolvedValue({ jobs: [row], diagnostics: [] });

    const result = await processCnFetchRun("user-1", {
      id: "run-1",
      queries: {
        queries: ["Java 后端工程师"],
        sources: ["nowcoder"],
      },
    });

    expect(store.importJobs).toHaveBeenCalledWith({
      userId: "user-1",
      items: [row],
    });
    expect(result).toEqual({
      userId: "user-1",
      runId: "run-1",
      discovered: 1,
      imported: 1,
    });
  });

  it("does not call the importer for an empty successful result", async () => {
    store.runCnFetch.mockResolvedValue({ jobs: [], diagnostics: [] });

    const result = await processCnFetchRun("user-1", {
      id: "run-1",
      queries: { queries: ["前端工程师"] },
    });

    expect(store.importJobs).not.toHaveBeenCalled();
    expect(result.imported).toBe(0);
  });

  it("marks the run failed when every configured source failed", async () => {
    store.runCnFetch.mockResolvedValue({
      jobs: [],
      diagnostics: [
        {
          source: "nowcoder",
          ok: false,
          raw: 0,
          error: "nowcoder_503",
        },
      ],
    });

    const result = await processCnFetchRun("user-1", {
      id: "run-1",
      queries: { queries: ["Java Engineer"] },
    });

    expect(result).toEqual({
      userId: "user-1",
      runId: "run-1",
      discovered: 0,
      imported: 0,
      error: "all sources failed: nowcoder: nowcoder_503",
    });
    expect(store.updateMany).toHaveBeenCalledWith({
      where: { id: "run-1", userId: "user-1", status: "RUNNING" },
      data: {
        status: "FAILED",
        importedCount: 0,
        error: "all sources failed: nowcoder: nowcoder_503",
      },
    });
  });

  it("does not import when the run was cancelled during the network fetch", async () => {
    store.runCnFetch.mockResolvedValue({
      jobs: [
        {
          jobUrl: "https://www.nowcoder.com/jobs/detail/1",
          title: "Java Engineer",
          company: "Acme",
          location: "Shanghai",
          jobType: "fulltime",
          jobLevel: "junior",
          description: "Java Spring",
          listingDate: "2026-07-20T00:00:00.000Z",
          market: "CN",
          source: "nowcoder",
        },
      ],
      diagnostics: [],
    });
    store.findFirst.mockResolvedValue(null);

    const result = await processCnFetchRun("user-1", {
      id: "run-1",
      queries: { queries: ["Java Engineer"] },
    });

    expect(result.cancelled).toBe(true);
    expect(store.importJobs).not.toHaveBeenCalled();
    expect(store.updateMany).not.toHaveBeenCalled();
  });
});
