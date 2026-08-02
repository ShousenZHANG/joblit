import { describe, expect, it, vi } from "vitest";
import { reconcileBoundApplicationBatch } from "@/lib/server/tailoringRuns/tailoringBatchProjection";
import type { TailoringRunTransaction } from "@/lib/server/tailoringRuns/tailoringRunDatabase";

describe("TailoringRun Application Batch projection", () => {
  it("uses the shared zero-task terminal projection while ABAT is already held", async () => {
    const applicationBatch = {
      findFirst: vi.fn().mockResolvedValue({
        id: "batch-1",
        status: "RUNNING",
        totalCount: 1,
        startedAt: new Date("2026-08-02T00:00:00.000Z"),
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
    } as unknown as TailoringRunTransaction;

    await expect(
      reconcileBoundApplicationBatch(tx, "user-1", "batch-1"),
    ).resolves.toEqual({
      batchStatus: "CANCELLED",
      progress: {
        pending: 0,
        running: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0,
      },
    });
    expect(applicationBatch.update).toHaveBeenCalledWith({
      where: { id: "batch-1" },
      data: {
        status: "CANCELLED",
        totalCount: 0,
        startedAt: new Date("2026-08-02T00:00:00.000Z"),
        completedAt: expect.any(Date),
        error: "No batch tasks remain.",
      },
    });
  });
});
