import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  applicationLock: vi.fn(),
  jobLock: vi.fn(),
  fetchLock: vi.fn(),
  lockBatches: vi.fn(),
  reconcileBatches: vi.fn(),
  enqueueArtifacts: vi.fn(),
  prepareArtifacts: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/server/applications/applicationMutationLock", () => ({
  acquireApplicationMutationLock: dependencies.applicationLock,
}));
vi.mock("@/lib/server/jobs/jobMutationLock", () => ({
  acquireJobMutationLock: dependencies.jobLock,
}));
vi.mock("@/lib/server/fetchRuns/fetchRunLifecycleLock", () => ({
  acquireFetchRunLifecycleLock: dependencies.fetchLock,
}));
vi.mock("@/lib/server/applicationBatches/batchReconciliation", () => ({
  lockApplicationBatchesForJobDeletion: dependencies.lockBatches,
  reconcileApplicationBatchesAfterJobDeletion: dependencies.reconcileBatches,
}));
vi.mock("@/lib/server/artifacts/applicationArtifactLifecycle", () => ({
  canonicalizeApplicationArtifactStorageIdentity: (value: string) => {
    const url = new URL(value);
    return {
      key: `${url.hostname.toLowerCase()}${url.pathname}`,
      storeHost: url.hostname.toLowerCase(),
      pathname: url.pathname.replace(/^\/+/, ""),
    };
  },
  enqueueApplicationArtifactRetirements: dependencies.enqueueArtifacts,
  prepareApplicationArtifactsForJobRetirement: dependencies.prepareArtifacts,
}));

import {
  previewLegacyMarketRetirement,
  retireGlobalJobsForUser,
  retireLegacyFetchRuns,
  retireLegacyMarketData,
} from "./legacyMarketRetirement";

const completedInventoryCheckpoint = {
  cursor: null,
  claimId: null,
  claimLeaseExpiresAt: null,
  scanStartedAt: null,
  completedAt: new Date("2026-08-09T00:00:00.000Z"),
};

function jobRetirementHarness() {
  const operations: string[] = [];
  const tx = {
    $queryRaw: vi.fn(async () => {
      operations.push("job.rows.lock");
      return [{ id: "a" }, { id: "b" }];
    }),
    job: {
      deleteMany: vi.fn(async () => {
        operations.push("job.deleteMany");
        return { count: 2 };
      }),
    },
    application: {
      findMany: vi.fn(async ({ where }: { where: { jobId: { in: string[] } } }) => {
        operations.push("application.findMany");
        return [
          {
            id: "application-a",
            jobId: "a",
            resumeTexUrl: null,
            resumePdfUrl: "https://blob.example/shared.pdf?download=1",
            coverTexUrl: null,
            coverPdfUrl: null,
          },
          {
            id: "application-b",
            jobId: "b",
            resumeTexUrl: null,
            resumePdfUrl: "https://blob.example/shared.pdf",
            coverTexUrl: null,
            coverPdfUrl: "https://blob.example/cover.pdf",
          },
        ].filter((application) => where.jobId.in.includes(application.jobId));
      }),
      deleteMany: vi.fn(async () => {
        operations.push("application.deleteMany");
        return { count: 2 };
      }),
    },
    claimEvidence: {
      findMany: vi.fn(async () => {
        operations.push("claimEvidence.findMany");
        return [{ evidenceSnapshotId: "evidence-1" }];
      }),
    },
    evidenceSnapshot: {
      deleteMany: vi.fn(async () => {
        operations.push("evidenceSnapshot.deleteMany");
        return { count: 1 };
      }),
    },
    // A sentinel proves the retirement path does not create URL tombstones.
    deletedJobUrl: { createMany: vi.fn(), upsert: vi.fn() },
  };
  const database = {
    $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
  return { operations, tx, database };
}

describe("legacy market retirement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dependencies.jobLock.mockImplementation(async () => {
      currentHarness?.operations.push("job.lock");
    });
    dependencies.applicationLock.mockImplementation(async (_tx, _user, jobId) => {
      const harness = currentHarness;
      harness?.operations.push(`application.lock:${jobId}`);
    });
    dependencies.fetchLock.mockImplementation(async () => undefined);
    dependencies.lockBatches.mockResolvedValue(["batch-1"]);
    dependencies.reconcileBatches.mockResolvedValue(undefined);
    dependencies.enqueueArtifacts.mockImplementation(async () => {
      currentHarness?.operations.push("artifact.enqueue");
      return { queued: 1 };
    });
    dependencies.prepareArtifacts.mockImplementation(async () => {
      currentHarness?.operations.push("artifact.prepare");
      return { queued: 2, deleting: 0 };
    });
    currentHarness = null;
  });

  let currentHarness: ReturnType<typeof jobRetirementHarness> | null = null;

  it("uses stable locks, queues unique artifacts, cleans evidence, and never writes tombstones", async () => {
    const harness = jobRetirementHarness();
    currentHarness = harness;

    const result = await retireGlobalJobsForUser(
      harness.database as never,
      { userId: "user-1", jobIds: ["b", "a", "a"] },
    );

    expect(dependencies.jobLock).toHaveBeenCalledTimes(1);
    expect(harness.operations.slice(0, 2)).toEqual(["job.lock", "job.rows.lock"]);
    expect(dependencies.applicationLock.mock.calls.map((call) => call[2])).toEqual([
      "a",
      "b",
    ]);
    expect(harness.tx.job.deleteMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["a", "b"] },
        userId: "user-1",
        market: "GLOBAL",
      },
    });
    expect(dependencies.enqueueArtifacts).toHaveBeenCalledTimes(2);
    expect(dependencies.enqueueArtifacts.mock.calls[0]?.[1].artifacts).toEqual([
      {
        target: "RESUME_PDF",
        url: "https://blob.example/shared.pdf?download=1",
      },
    ]);
    expect(dependencies.enqueueArtifacts.mock.calls[1]?.[1].artifacts).toEqual([
      { target: "COVER_PDF", url: "https://blob.example/cover.pdf" },
    ]);
    expect(harness.operations.indexOf("artifact.enqueue")).toBeLessThan(
      harness.operations.indexOf("application.deleteMany"),
    );
    expect(harness.tx.evidenceSnapshot.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        OR: [
          { jobId: { in: ["a", "b"] } },
          {
            applicationId: { in: ["application-a", "application-b"] },
          },
          { id: { in: ["evidence-1"] } },
        ],
        claims: { none: {} },
      },
    });
    expect(harness.tx.deletedJobUrl.createMany).not.toHaveBeenCalled();
    expect(harness.tx.deletedJobUrl.upsert).not.toHaveBeenCalled();
    expect(dependencies.reconcileBatches).toHaveBeenCalledWith(
      expect.anything(),
      { userId: "user-1", batchIds: ["batch-1"] },
    );
    expect(result).toEqual({
      selected: 2,
      deleted: 2,
      applicationsDeleted: 2,
      evidenceSnapshotsDeleted: 1,
      artifactsQueued: 2,
      artifactsDeleting: 0,
      applicationBatchesReconciled: 1,
    });
  });

  it("preserves dependants when no requested Job remains GLOBAL at the row lock", async () => {
    const harness = jobRetirementHarness();
    harness.tx.$queryRaw.mockResolvedValueOnce([]);

    const result = await retireGlobalJobsForUser(
      harness.database as never,
      { userId: "user-1", jobIds: ["a"] },
    );

    expect(result.deleted).toBe(0);
    expect(harness.tx.application.findMany).not.toHaveBeenCalled();
    expect(harness.tx.job.deleteMany).not.toHaveBeenCalled();
    expect(dependencies.jobLock).toHaveBeenCalledTimes(1);
  });

  it("cleans only the authoritative GLOBAL rows returned by the lock", async () => {
    const harness = jobRetirementHarness();
    currentHarness = harness;
    harness.tx.$queryRaw.mockResolvedValueOnce([{ id: "a" }]);
    harness.tx.job.deleteMany.mockResolvedValueOnce({ count: 1 });

    const result = await retireGlobalJobsForUser(harness.database as never, {
      userId: "user-1",
      jobIds: ["a", "b"],
    });

    expect(harness.tx.application.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1", jobId: { in: ["a"] } },
    });
    expect(harness.tx.job.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["a"] }, userId: "user-1", market: "GLOBAL" },
    });
    expect(result).toMatchObject({ selected: 1, deleted: 1 });
  });

  it("rolls back when a locked GLOBAL row is not deleted", async () => {
    const harness = jobRetirementHarness();
    currentHarness = harness;
    harness.tx.job.deleteMany.mockResolvedValueOnce({ count: 1 });

    await expect(
      retireGlobalJobsForUser(harness.database as never, {
        userId: "user-1",
        jobIds: ["a", "b"],
      }),
    ).rejects.toThrow("expected 2, deleted 1");
  });

  it("locks legacy FetchRuns in stable order and relies on receipt cascade", async () => {
    const tx = {
      fetchRun: {
        findMany: vi.fn(async () => [{ id: "a" }, { id: "z" }]),
        deleteMany: vi.fn(async () => ({ count: 2 })),
      },
      fetchRunCommitReceipt: { count: vi.fn(async () => 7) },
    };
    const database = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };

    const result = await retireLegacyFetchRuns(database as never, ["z", "a", "a"]);

    expect(dependencies.fetchLock.mock.calls.map((call) => call[1])).toEqual([
      "a",
      "z",
    ]);
    expect(tx.fetchRun.deleteMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["a", "z"] },
        market: { in: ["CN", "GLOBAL"] },
      },
    });
    expect(result).toEqual({ selected: 2, deleted: 2, receiptsDeleted: 7 });
  });

  it("defaults to a read-only preview", async () => {
    const database = {
      $queryRaw: vi.fn(async () => [{ count: 0 }]),
      job: {
        count: vi.fn(async () => 0),
      },
      application: { count: vi.fn(async () => 0) },
      fetchRun: { count: vi.fn(async () => 32) },
      fetchRunCommitReceipt: { count: vi.fn(async () => 4) },
      applicationArtifactInventoryCheckpoint: {
        findUnique: vi.fn(async () => completedInventoryCheckpoint),
      },
    };

    const result = await retireLegacyMarketData({ database: database as never });

    expect(result.mode).toBe("DRY_RUN");
    expect(result.preview).toEqual({
      globalJobs: 0,
      globalApplications: 0,
      legacyFetchRuns: 32,
      legacyFetchRunReceipts: 4,
      activeOrphanArtifacts: 0,
      inventoryCompleted: true,
      inventoryCompletedAt: "2026-08-09T00:00:00.000Z",
    });
    expect(result.jobs.deleted).toBe(0);
    expect(result.fetchRuns.deleted).toBe(0);
    expect(database.job.count).toHaveBeenCalledTimes(1);
    expect(
      database.applicationArtifactInventoryCheckpoint.findUnique,
    ).toHaveBeenCalledWith({
      where: { key: "vercel-applications-v1" },
      select: {
        cursor: true,
        claimId: true,
        claimLeaseExpiresAt: true,
        scanStartedAt: true,
        completedAt: true,
      },
    });
  });

  it("keeps Stage 2 closed until a full Artifact inventory scan is settled", async () => {
    const checkpoint = vi.fn(async () => ({
      ...completedInventoryCheckpoint,
      cursor: "next-page",
      claimId: "inventory-claim",
      claimLeaseExpiresAt: new Date("2026-08-09T00:02:00.000Z"),
      scanStartedAt: new Date("2026-08-09T00:00:00.000Z"),
    }));
    const database = {
      $queryRaw: vi.fn(async () => [{ count: 0 }]),
      job: { count: vi.fn(async () => 0) },
      application: { count: vi.fn(async () => 0) },
      fetchRun: { count: vi.fn(async () => 0) },
      fetchRunCommitReceipt: { count: vi.fn(async () => 0) },
      applicationArtifactInventoryCheckpoint: { findUnique: checkpoint },
    };

    const result = await retireLegacyMarketData({ database: database as never });

    expect(result.stage2Ready).toBe(false);
    expect(result.artifactReconciliation).toMatchObject({
      activeOrphans: 0,
      inventoryCompleted: false,
      inventoryCompletedAt: null,
    });
    expect(checkpoint).toHaveBeenCalledTimes(1);
  });

  it("opens Stage 2 only after legacy rows, orphan Artifacts, and inventory converge", async () => {
    const database = {
      $queryRaw: vi.fn(async () => [{ count: 0 }]),
      job: { count: vi.fn(async () => 0) },
      application: { count: vi.fn(async () => 0) },
      fetchRun: { count: vi.fn(async () => 0) },
      fetchRunCommitReceipt: { count: vi.fn(async () => 0) },
      applicationArtifactInventoryCheckpoint: {
        findUnique: vi.fn(async () => completedInventoryCheckpoint),
      },
    };

    const preview = await previewLegacyMarketRetirement(database as never);
    const result = await retireLegacyMarketData({ database: database as never });

    expect(preview).toMatchObject({
      inventoryCompleted: true,
      inventoryCompletedAt: "2026-08-09T00:00:00.000Z",
    });
    expect(result.stage2Ready).toBe(true);
  });

  it("commits only the configured bounded page and reports remaining work", async () => {
    const remainingRunIds = ["run-a", "run-b"];
    const tx = {
      fetchRun: {
        findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
          where.id.in
            .filter((id) => remainingRunIds.includes(id))
            .map((id) => ({ id })),
        ),
        deleteMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => {
          let count = 0;
          for (const id of where.id.in) {
            const index = remainingRunIds.indexOf(id);
            if (index >= 0) {
              remainingRunIds.splice(index, 1);
              count += 1;
            }
          }
          return { count };
        }),
      },
      fetchRunCommitReceipt: { count: vi.fn(async () => 1) },
    };
    const database = {
      $queryRaw: vi.fn(async () => [{ count: 0 }]),
      job: {
        count: vi.fn(async () => 0),
        findMany: vi.fn(async () => []),
      },
      application: { count: vi.fn(async () => 0) },
      fetchRun: {
        count: vi.fn(async () => remainingRunIds.length),
        findMany: vi.fn(async ({ take }: { take: number }) =>
          remainingRunIds.slice(0, take).map((id) => ({ id })),
        ),
      },
      fetchRunCommitReceipt: { count: vi.fn(async () => 2) },
      applicationArtifactInventoryCheckpoint: {
        findUnique: vi.fn(async () => completedInventoryCheckpoint),
      },
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };

    const result = await retireLegacyMarketData({
      database: database as never,
      dryRun: false,
      batchSize: 1,
      maxBatches: 1,
    });

    expect(result.fetchRuns).toMatchObject({
      batchesProcessed: 1,
      selected: 1,
      deleted: 1,
      receiptsDeleted: 1,
      remaining: 1,
    });
    expect(result.capped).toBe(true);
    expect(remainingRunIds).toEqual(["run-b"]);
  });
});
