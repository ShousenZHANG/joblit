import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@/lib/generated/prisma";
import {
  deriveApplicationBatchStatus,
  reconcileApplicationBatchTx,
} from "@/lib/server/applicationBatches/batchReconciliation";

const ZERO_PROGRESS = {
  pending: 0,
  running: 0,
  succeeded: 0,
  failed: 0,
  skipped: 0,
};

describe("Application Batch reconciliation", () => {
  it("projects a non-terminal zero-task batch to CANCELLED", () => {
    expect(
      deriveApplicationBatchStatus({
        currentStatus: "QUEUED",
        progress: ZERO_PROGRESS,
      }),
    ).toBe("CANCELLED");
    expect(
      deriveApplicationBatchStatus({
        currentStatus: "RUNNING",
        progress: ZERO_PROGRESS,
      }),
    ).toBe("CANCELLED");
  });

  it("does not claim that deleting another task started a queued batch", () => {
    expect(
      deriveApplicationBatchStatus({
        currentStatus: "QUEUED",
        progress: { ...ZERO_PROGRESS, pending: 2 },
      }),
    ).toBe("QUEUED");
    expect(
      deriveApplicationBatchStatus({
        currentStatus: "QUEUED",
        progress: { ...ZERO_PROGRESS, pending: 1, succeeded: 1 },
      }),
    ).toBe("RUNNING");
  });

  it("persists the zero-task terminal state and the authoritative count", async () => {
    const applicationBatch = {
      findFirst: vi.fn().mockResolvedValue({
        id: "batch-1",
        status: "QUEUED",
        totalCount: 1,
        startedAt: null,
        completedAt: null,
      }),
      update: vi.fn().mockResolvedValue({}),
    };
    const applicationBatchTask = {
      groupBy: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn(),
    };
    const tx = {
      applicationBatch,
      applicationBatchTask,
    } as unknown as Prisma.TransactionClient;

    await expect(
      reconcileApplicationBatchTx(tx, {
        userId: "user-1",
        batchId: "batch-1",
        emptyError: "All jobs in this batch were deleted.",
      }),
    ).resolves.toMatchObject({
      batchStatus: "CANCELLED",
      progress: ZERO_PROGRESS,
      totalCount: 0,
    });
    expect(applicationBatch.update).toHaveBeenCalledWith({
      where: { id: "batch-1" },
      data: {
        status: "CANCELLED",
        totalCount: 0,
        startedAt: null,
        completedAt: expect.any(Date),
        error: "All jobs in this batch were deleted.",
      },
    });
  });
});
