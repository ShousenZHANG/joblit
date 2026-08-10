import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  executeRaw: vi.fn(),
  transaction: vi.fn(),
  applicationBatch: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  applicationBatchTask: {
    findMany: vi.fn(),
    createMany: vi.fn(),
  },
  job: { findMany: vi.fn() },
  resumeProfile: { findFirst: vi.fn() },
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    $transaction: store.transaction,
    applicationBatch: store.applicationBatch,
  },
}));

import { queueApplicationBatch } from "@/lib/server/applicationBatches/queueApplicationBatch";

function transactionClient() {
  return {
    $executeRaw: store.executeRaw,
    applicationBatch: store.applicationBatch,
    applicationBatchTask: store.applicationBatchTask,
    job: store.job,
    resumeProfile: store.resumeProfile,
  };
}

describe("queueApplicationBatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.executeRaw.mockResolvedValue(0);
    store.resumeProfile.findFirst.mockResolvedValue({ id: "profile-1" });
    store.transaction.mockImplementation(
      async (callback: (tx: ReturnType<typeof transactionClient>) => unknown) =>
        callback(transactionClient()),
    );
  });

  it("queues failed tasks through the same locked transaction as fresh batches", async () => {
    store.applicationBatch.findFirst
      .mockResolvedValueOnce({ id: "source-batch" })
      .mockResolvedValueOnce(null);
    store.applicationBatchTask.findMany.mockResolvedValueOnce([
      { jobId: "job-2" },
      { jobId: "job-1" },
    ]);
    store.applicationBatch.create.mockResolvedValueOnce({
      id: "retry-batch",
      totalCount: 2,
      createdAt: new Date("2026-08-02T00:00:00.000Z"),
    });
    store.applicationBatchTask.createMany.mockResolvedValueOnce({ count: 2 });

    await expect(
      queueApplicationBatch({
        userId: "user-1",
        seed: {
          kind: "retry_failed",
          sourceBatchId: "source-batch",
          limit: 20,
        },
      }),
    ).resolves.toMatchObject({
      kind: "queued",
      sourceBatchId: "source-batch",
      batch: { id: "retry-batch", status: "QUEUED", totalCount: 2 },
    });

    expect(store.executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      store.applicationBatch.findFirst.mock.invocationCallOrder[0]!,
    );
    expect(store.applicationBatchTask.findMany).toHaveBeenCalledWith({
      where: {
        batchId: "source-batch",
        userId: "user-1",
        status: "FAILED",
        job: {
          userId: "user-1",
          market: "AU",
          status: "NEW",
          applications: { none: { userId: "user-1" } },
        },
      },
      orderBy: { updatedAt: "desc" },
      distinct: ["jobId"],
      take: 20,
      select: { jobId: true },
    });
    expect(store.applicationBatchTask.createMany).toHaveBeenCalledWith({
      data: [
        {
          batchId: "retry-batch",
          userId: "user-1",
          jobId: "job-2",
          status: "PENDING",
        },
        {
          batchId: "retry-batch",
          userId: "user-1",
          jobId: "job-1",
          status: "PENDING",
        },
      ],
    });
  });

  it("does not create a header when the retry source has no failed tasks", async () => {
    store.applicationBatch.findFirst
      .mockResolvedValueOnce({ id: "source-batch" })
      .mockResolvedValueOnce(null);
    store.applicationBatchTask.findMany.mockResolvedValueOnce([]);

    await expect(
      queueApplicationBatch({
        userId: "user-1",
        seed: { kind: "retry_failed", sourceBatchId: "source-batch" },
      }),
    ).resolves.toEqual({ kind: "empty", reason: "NO_FAILED_TASKS" });
    expect(store.applicationBatch.create).not.toHaveBeenCalled();
    expect(store.applicationBatchTask.createMany).not.toHaveBeenCalled();
  });

  it("rolls back instead of returning a header with fewer tasks", async () => {
    store.applicationBatch.findFirst
      .mockResolvedValueOnce({ id: "source-batch" })
      .mockResolvedValueOnce(null);
    store.applicationBatchTask.findMany.mockResolvedValueOnce([
      { jobId: "job-1" },
    ]);
    store.applicationBatch.create.mockResolvedValueOnce({
      id: "batch-1",
      totalCount: 1,
      createdAt: new Date("2026-08-02T00:00:00.000Z"),
    });
    store.applicationBatchTask.createMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      queueApplicationBatch({
        userId: "user-1",
        seed: { kind: "retry_failed", sourceBatchId: "source-batch" },
      }),
    ).rejects.toThrow("task count did not match its header");
  });

  it("retries once when a mixed-deploy winner disappears before conflict lookup", async () => {
    store.applicationBatch.findFirst
      // attempt 1: source lookup, then the active-batch probe
      .mockResolvedValueOnce({ id: "source-batch" })
      .mockResolvedValueOnce(null)
      // post-rollback probe: the winner is already gone
      .mockResolvedValueOnce(null)
      // attempt 2: source lookup, then the active-batch probe
      .mockResolvedValueOnce({ id: "source-batch" })
      .mockResolvedValueOnce(null);
    store.applicationBatchTask.findMany
      .mockResolvedValueOnce([{ jobId: "job-1" }])
      .mockResolvedValueOnce([{ jobId: "job-1" }]);
    store.applicationBatch.create
      .mockRejectedValueOnce({ code: "P2002" })
      .mockResolvedValueOnce({
        id: "batch-after-race",
        totalCount: 1,
        createdAt: new Date("2026-08-02T00:00:00.000Z"),
      });
    store.applicationBatchTask.createMany.mockResolvedValueOnce({ count: 1 });

    await expect(
      queueApplicationBatch({
        userId: "user-1",
        seed: { kind: "retry_failed", sourceBatchId: "source-batch" },
      }),
    ).resolves.toMatchObject({
      kind: "queued",
      batch: { id: "batch-after-race", totalCount: 1 },
    });

    expect(store.transaction).toHaveBeenCalledTimes(2);
    expect(store.applicationBatch.create).toHaveBeenCalledTimes(2);
  });
});
