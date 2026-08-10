import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaStore = vi.hoisted(() => {
  const store = {
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
    applicationBatch: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    applicationBatchTask: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
      groupBy: vi.fn(),
    },
    tailoringRun: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  };

  store.$transaction.mockImplementation(
    async (callback: (tx: typeof store) => Promise<unknown>) => callback(store),
  );
  return store;
});

vi.mock("@/lib/server/prisma", () => ({
  prisma: prismaStore,
}));

import {
  cancelBatch,
  claimNextBatchTask,
  completeBatchTask,
  getBatchLeaseRetryHint,
  releaseBatchTask,
} from "@/lib/server/applicationBatches/runner";

const BATCH_ID = "550e8400-e29b-41d4-a716-446655440000";
const TASK_ID = "660e8400-e29b-41d4-a716-446655440000";
const JOB_ID = "770e8400-e29b-41d4-a716-446655440000";
const OLD_ATTEMPT_ID = "880e8400-e29b-41d4-a716-446655440000";
const RUN_ID = "990e8400-e29b-41d4-a716-446655440000";
const APPLICATION_ID = "aa0e8400-e29b-41d4-a716-446655440000";

describe("application batch runner", () => {
  beforeEach(() => {
    prismaStore.$transaction.mockClear();
    prismaStore.$executeRaw.mockReset();
    prismaStore.applicationBatch.findFirst.mockReset();
    prismaStore.applicationBatch.updateMany.mockReset();
    prismaStore.applicationBatch.update.mockReset();
    prismaStore.applicationBatchTask.findFirst.mockReset();
    prismaStore.applicationBatchTask.findMany.mockReset();
    prismaStore.applicationBatchTask.updateMany.mockReset();
    prismaStore.applicationBatchTask.update.mockReset();
    prismaStore.applicationBatchTask.groupBy.mockReset();
    prismaStore.tailoringRun.findFirst.mockReset();
    prismaStore.tailoringRun.findFirst.mockResolvedValue(null);
    prismaStore.tailoringRun.findMany.mockReset();
    prismaStore.tailoringRun.update.mockReset();
    prismaStore.tailoringRun.updateMany.mockReset();
  });

  it("claims under the ABAT transaction lock and returns the execution attempt", async () => {
    prismaStore.applicationBatch.findFirst.mockResolvedValueOnce({
      id: BATCH_ID,
      status: "RUNNING",
    });
    prismaStore.applicationBatchTask.updateMany.mockResolvedValueOnce({
      count: 1,
    });
    prismaStore.applicationBatchTask.findFirst.mockResolvedValueOnce({
      id: TASK_ID,
      jobId: JOB_ID,
      job: {
        title: "Software Engineer",
        company: "Acme",
        jobUrl: "https://example.com/jobs/1",
      },
    });
    prismaStore.applicationBatchTask.update.mockResolvedValueOnce({});

    const claimed = await claimNextBatchTask({
      userId: "user-1",
      batchId: BATCH_ID,
    });

    expect(claimed.kind).toBe("claimed");
    if (claimed.kind !== "claimed") return;

    expect(claimed.task.attemptId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(prismaStore.$transaction).toHaveBeenCalledWith(expect.any(Function));
    expect(String(prismaStore.$executeRaw.mock.calls[0]?.[0])).toContain(
      "pg_advisory_xact_lock",
    );
    expect(prismaStore.applicationBatchTask.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "RUNNING",
          completedAt: null,
          OR: [
            {
              executionLeaseExpiresAt: {
                lte: expect.any(Date),
              },
            },
            {
              executionLeaseExpiresAt: null,
              startedAt: {
                lte: expect.any(Date),
              },
            },
          ],
        }),
        data: expect.objectContaining({
          status: "PENDING",
          startedAt: null,
          completedAt: null,
          executionAttemptId: null,
          executionLeaseExpiresAt: null,
          completionAttemptId: null,
          attempt: { increment: 1 },
        }),
      }),
    );
    expect(prismaStore.applicationBatchTask.updateMany).toHaveBeenCalledWith({
      where: {
        batchId: BATCH_ID,
        userId: "user-1",
        status: "PENDING",
        OR: [
          { job: { userId: { not: "user-1" } } },
          { job: { market: { not: "AU" } } },
          { job: { status: { not: "NEW" } } },
          {
            AND: [
              { tailoringRun: null },
              {
                job: {
                  applications: { some: { userId: "user-1" } },
                },
              },
            ],
          },
        ],
      },
      data: {
        status: "SKIPPED",
        completedAt: expect.any(Date),
        error: "Skipped because the Job is no longer safe for a fresh batch",
      },
    });
    expect(prismaStore.applicationBatchTask.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          batchId: BATCH_ID,
          userId: "user-1",
          status: "PENDING",
          job: { userId: "user-1", market: "AU", status: "NEW" },
          OR: [
            { tailoringRun: { isNot: null } },
            {
              job: {
                applications: { none: { userId: "user-1" } },
              },
            },
          ],
        },
      }),
    );
    expect(prismaStore.applicationBatchTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: TASK_ID },
        data: expect.objectContaining({
          status: "RUNNING",
          executionAttemptId: claimed.task.attemptId,
          executionLeaseExpiresAt: expect.any(Date),
          tailoringProtocolVersion: 1,
          completionAttemptId: null,
        }),
      }),
    );
    expect(claimed.task).toMatchObject({
      protocolVersion: 1,
      acceptedTargets: [],
      remainingTargets: ["RESUME", "COVER"],
    });
    expect(claimed.task.issueKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("selects protocol v2 only for an unbound task whose Runner advertises it", async () => {
    prismaStore.applicationBatch.findFirst.mockResolvedValueOnce({
      id: BATCH_ID,
      status: "RUNNING",
    });
    prismaStore.applicationBatchTask.updateMany.mockResolvedValueOnce({ count: 0 });
    prismaStore.applicationBatchTask.findFirst.mockResolvedValueOnce({
      id: TASK_ID,
      jobId: JOB_ID,
      job: {
        title: "Software Engineer",
        company: "Acme",
        jobUrl: "https://example.com/jobs/1",
      },
      tailoringRun: null,
    });
    prismaStore.applicationBatchTask.update.mockResolvedValueOnce({});

    const claimed = await claimNextBatchTask({
      userId: "user-1",
      batchId: BATCH_ID,
      supportedProtocolVersions: [2, 1],
    });

    expect(claimed.kind).toBe("claimed");
    if (claimed.kind !== "claimed") return;
    expect(claimed.task).toMatchObject({
      protocolVersion: 2,
      delivery: "DRAFT",
      acceptedTargets: [],
      remainingTargets: ["RESUME", "COVER"],
      remainingPublicationTargets: [],
    });
    expect(prismaStore.applicationBatchTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tailoringProtocolVersion: 2 }),
      }),
    );
  });

  it("caps the retry poll while preserving the earliest lease deadline", async () => {
    const now = new Date("2026-02-22T10:00:00.000Z");
    prismaStore.applicationBatchTask.findMany.mockResolvedValueOnce([
      {
        executionLeaseExpiresAt: new Date("2026-02-22T10:20:00.000Z"),
        startedAt: now,
      },
      {
        executionLeaseExpiresAt: new Date("2026-02-22T10:02:00.000Z"),
        startedAt: now,
      },
    ]);

    await expect(
      getBatchLeaseRetryHint({
        userId: "user-1",
        batchId: BATCH_ID,
        now,
      }),
    ).resolves.toEqual({
      retryAfterMs: 30_000,
      earliestLeaseExpiresAt: "2026-02-22T10:02:00.000Z",
    });
    expect(prismaStore.applicationBatchTask.findMany).toHaveBeenCalledWith({
      where: {
        batchId: BATCH_ID,
        userId: "user-1",
        status: "RUNNING",
        completedAt: null,
      },
      select: {
        executionLeaseExpiresAt: true,
        startedAt: true,
      },
    });
  });

  it("reclaims only the missing target from a partially accepted run", async () => {
    prismaStore.applicationBatch.findFirst.mockResolvedValueOnce({
      id: BATCH_ID,
      status: "RUNNING",
    });
    prismaStore.applicationBatchTask.updateMany.mockResolvedValueOnce({
      count: 1,
    });
    prismaStore.applicationBatchTask.findFirst.mockResolvedValueOnce({
      id: TASK_ID,
      jobId: JOB_ID,
      job: {
        title: "Software Engineer",
        company: "Acme",
        jobUrl: "https://example.com/jobs/1",
      },
      tailoringRun: {
        id: RUN_ID,
        status: "RUNNING",
        attempt: 1,
        startedAt: new Date("2026-02-22T09:00:00.000Z"),
        executionAttemptId: OLD_ATTEMPT_ID,
        applicationId: APPLICATION_ID,
        application: { aiContentHash: "legacy-content-hash" },
        requiredTargetMask: 3,
        acceptedTargetMask: 1,
        delivery: "FINAL",
        publicationRequiredTargetMask: 0,
        publishedTargetMask: 0,
      },
    });
    prismaStore.applicationBatchTask.update.mockResolvedValueOnce({});

    const claimed = await claimNextBatchTask({
      userId: "user-1",
      batchId: BATCH_ID,
      supportedProtocolVersions: [2, 1],
    });

    expect(claimed.kind).toBe("claimed");
    if (claimed.kind !== "claimed") return;
    expect(claimed.task).toMatchObject({
      acceptedTargets: ["RESUME"],
      remainingTargets: ["COVER"],
      protocolVersion: 1,
      delivery: "FINAL",
      remainingPublicationTargets: [],
    });
  });

  it("rebinds an expired v2 publication-only run to the newly claimed task attempt", async () => {
    prismaStore.applicationBatch.findFirst.mockResolvedValueOnce({
      id: BATCH_ID,
      status: "RUNNING",
    });
    prismaStore.applicationBatchTask.updateMany.mockResolvedValueOnce({ count: 1 });
    prismaStore.applicationBatchTask.findFirst.mockResolvedValueOnce({
      id: TASK_ID,
      jobId: JOB_ID,
      job: {
        title: "Software Engineer",
        company: "Acme",
        jobUrl: "https://example.com/jobs/1",
      },
      tailoringRun: {
        id: RUN_ID,
        status: "RUNNING",
        attempt: 1,
        executionAttemptId: OLD_ATTEMPT_ID,
        requiredTargetMask: 3,
        acceptedTargetMask: 3,
        publicationRequiredTargetMask: 3,
        publishedTargetMask: 1,
        delivery: "DRAFT",
        issueKey: "issue-v2",
        applicationId: APPLICATION_ID,
        application: { aiContentHash: "durable-content-hash" },
      },
    });
    prismaStore.applicationBatchTask.update.mockResolvedValueOnce({});
    prismaStore.tailoringRun.update.mockResolvedValueOnce({});

    const claimed = await claimNextBatchTask({
      userId: "user-1",
      batchId: BATCH_ID,
      supportedProtocolVersions: [2, 1],
    });

    expect(claimed.kind).toBe("claimed");
    if (claimed.kind !== "claimed") return;
    expect(claimed.task).toMatchObject({
      protocolVersion: 2,
      delivery: "DRAFT",
      remainingTargets: [],
      remainingPublicationTargets: ["COVER"],
      applicationId: APPLICATION_ID,
      applicationAiContentHash: "durable-content-hash",
      tailoringRun: {
        id: RUN_ID,
        attemptId: claimed.task.attemptId,
      },
    });
    expect(prismaStore.tailoringRun.update).toHaveBeenCalledWith({
      where: { id: RUN_ID },
      data: expect.objectContaining({
        status: "RUNNING",
        executionAttemptId: claimed.task.attemptId,
        executionLeaseExpiresAt: expect.any(Date),
        attempt: { increment: 1 },
      }),
    });
  });

  it("releases an ambiguous v2 publication immediately and fences its late attempt", async () => {
    prismaStore.applicationBatchTask.findFirst.mockResolvedValueOnce({
      id: TASK_ID,
      status: "RUNNING",
      executionAttemptId: OLD_ATTEMPT_ID,
      tailoringProtocolVersion: 2,
      tailoringRun: { id: RUN_ID, executionAttemptId: OLD_ATTEMPT_ID },
    });
    prismaStore.applicationBatchTask.update.mockResolvedValueOnce({});
    prismaStore.tailoringRun.update.mockResolvedValueOnce({});

    await expect(
      releaseBatchTask({
        userId: "user-1",
        batchId: BATCH_ID,
        taskId: TASK_ID,
        attemptId: OLD_ATTEMPT_ID,
        reason: "PUBLICATION_SETTLEMENT_UNKNOWN",
      }),
    ).resolves.toEqual({ released: true, replayed: false });

    expect(prismaStore.applicationBatchTask.update).toHaveBeenCalledWith({
      where: { id: TASK_ID },
      data: expect.objectContaining({
        status: "PENDING",
        executionAttemptId: OLD_ATTEMPT_ID,
        executionLeaseExpiresAt: null,
      }),
    });
    expect(prismaStore.tailoringRun.update).toHaveBeenCalledWith({
      where: { id: RUN_ID },
      data: expect.objectContaining({
        status: "RUNNING",
        executionAttemptId: expect.not.stringMatching(OLD_ATTEMPT_ID),
        executionLeaseExpiresAt: null,
      }),
    });
  });

  it("does not let an old attempt complete a newly claimed task", async () => {
    prismaStore.applicationBatch.findFirst.mockResolvedValueOnce({
      id: BATCH_ID,
      status: "RUNNING",
    });
    prismaStore.applicationBatchTask.findFirst
      .mockResolvedValueOnce({
        id: TASK_ID,
        jobId: JOB_ID,
        job: {
          title: "Software Engineer",
          company: "Acme",
          jobUrl: "https://example.com/jobs/1",
        },
      })
      .mockImplementationOnce(async () => {
        const claimWrite =
          prismaStore.applicationBatchTask.update.mock.calls[0]?.[0];
        return {
          id: TASK_ID,
          status: "RUNNING",
          executionAttemptId: claimWrite?.data.executionAttemptId,
        };
      });
    prismaStore.applicationBatchTask.update.mockResolvedValueOnce({});

    const claimed = await claimNextBatchTask({
      userId: "user-1",
      batchId: BATCH_ID,
      skipStaleReclaim: true,
    });
    expect(claimed.kind).toBe("claimed");

    await expect(
      completeBatchTask({
        userId: "user-1",
        batchId: BATCH_ID,
        taskId: TASK_ID,
        attemptId: OLD_ATTEMPT_ID,
        status: "FAILED",
        error: "old worker finished late",
      }),
    ).rejects.toMatchObject({
      code: "INVALID_STATE",
      message: "Task execution attempt is stale",
    });

    expect(prismaStore.applicationBatchTask.update).toHaveBeenCalledTimes(1);
  });

  it("rejects a late old-attempt success after a newer claim owns the task", async () => {
    const currentAttemptId = "990e8400-e29b-41d4-a716-446655440000";
    prismaStore.applicationBatchTask.findFirst.mockResolvedValueOnce({
      id: TASK_ID,
      status: "RUNNING",
      executionAttemptId: currentAttemptId,
    });

    await expect(
      completeBatchTask({
        userId: "user-1",
        batchId: BATCH_ID,
        taskId: TASK_ID,
        attemptId: OLD_ATTEMPT_ID,
        status: "SUCCEEDED",
      }),
    ).rejects.toMatchObject({
      code: "INVALID_STATE",
      message: "Task execution attempt is stale",
    });

    expect(prismaStore.applicationBatchTask.update).not.toHaveBeenCalled();
    expect(prismaStore.applicationBatchTask.updateMany).not.toHaveBeenCalled();
  });

  it("settles a bound partial run and failed task in the same locked transaction", async () => {
    prismaStore.applicationBatchTask.findFirst.mockResolvedValueOnce({
      id: TASK_ID,
      status: "RUNNING",
      executionAttemptId: OLD_ATTEMPT_ID,
    });
    prismaStore.tailoringRun.findFirst.mockResolvedValue({
      id: "990e8400-e29b-41d4-a716-446655440000",
      status: "RUNNING",
      acceptedTargetMask: 1,
      executionAttemptId: OLD_ATTEMPT_ID,
      attempt: 1,
    });
    prismaStore.tailoringRun.update.mockResolvedValueOnce({});
    prismaStore.applicationBatchTask.update.mockResolvedValueOnce({});
    prismaStore.applicationBatch.findFirst.mockResolvedValueOnce({
      id: BATCH_ID,
      status: "RUNNING",
      startedAt: new Date(),
      completedAt: null,
    });
    prismaStore.applicationBatchTask.groupBy.mockResolvedValueOnce([
      { status: "FAILED", _count: { _all: 1 } },
    ]);
    prismaStore.applicationBatch.update.mockResolvedValueOnce({});

    const result = await completeBatchTask({
      userId: "user-1",
      batchId: BATCH_ID,
      taskId: TASK_ID,
      attemptId: OLD_ATTEMPT_ID,
      status: "FAILED",
      error: "executor run_private failed",
    });

    expect(result.taskStatus).toBe("FAILED");
    expect(prismaStore.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaStore.tailoringRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "PARTIAL",
          executionAttemptId: OLD_ATTEMPT_ID,
          errorCode: "BATCH_TASK_FAILED",
          errorMessage: "executor [private executor id] failed",
        }),
      }),
    );
    expect(prismaStore.applicationBatchTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          error: "executor [private executor id] failed",
          completionAttemptId: null,
        }),
      }),
    );
    expect(prismaStore.$executeRaw.mock.calls.map((call) => call[1])).toEqual([
      0x41424154, 0x544c524e,
    ]);
  });

  it("rejects independent success completion even for the current attempt", async () => {
    prismaStore.applicationBatchTask.findFirst.mockResolvedValueOnce({
      id: TASK_ID,
      status: "RUNNING",
      executionAttemptId: OLD_ATTEMPT_ID,
    });

    await expect(
      completeBatchTask({
        userId: "user-1",
        batchId: BATCH_ID,
        taskId: TASK_ID,
        attemptId: OLD_ATTEMPT_ID,
        status: "SUCCEEDED",
      }),
    ).rejects.toMatchObject({
      code: "INVALID_STATE",
      message: "Task success is committed by TailoringRun acceptance",
    });

    expect(prismaStore.applicationBatchTask.update).not.toHaveBeenCalled();
  });

  it("cancels both pending and running tasks as skipped", async () => {
    prismaStore.applicationBatch.findFirst.mockResolvedValueOnce({
      id: BATCH_ID,
      status: "RUNNING",
    });
    prismaStore.applicationBatch.update.mockResolvedValueOnce({});
    prismaStore.applicationBatchTask.updateMany.mockResolvedValueOnce({
      count: 2,
    });
    prismaStore.tailoringRun.findMany.mockResolvedValueOnce([
      { id: "990e8400-e29b-41d4-a716-446655440000" },
      { id: "880e8400-e29b-41d4-a716-446655440000" },
    ]);
    prismaStore.tailoringRun.updateMany.mockResolvedValue({ count: 1 });
    prismaStore.applicationBatchTask.groupBy.mockResolvedValueOnce([
      { status: "SKIPPED", _count: { _all: 2 } },
    ]);

    const result = await cancelBatch({
      userId: "user-1",
      batchId: BATCH_ID,
    });

    expect(result).toMatchObject({
      batchStatus: "CANCELLED",
      alreadyTerminal: false,
      progress: {
        pending: 0,
        running: 0,
        skipped: 2,
      },
    });
    expect(prismaStore.applicationBatchTask.updateMany).toHaveBeenCalledWith({
      where: {
        batchId: BATCH_ID,
        userId: "user-1",
        status: {
          in: ["PENDING", "RUNNING"],
        },
      },
      data: expect.objectContaining({
        status: "SKIPPED",
        error: "Cancelled by user",
        completedAt: expect.any(Date),
        executionLeaseExpiresAt: null,
        completionAttemptId: null,
      }),
    });
    expect(prismaStore.$executeRaw.mock.calls.map((call) => call[1])).toEqual([
      0x41424154, 0x544c524e, 0x544c524e,
    ]);
  });
});
