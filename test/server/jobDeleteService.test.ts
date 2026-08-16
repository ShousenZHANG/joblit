import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaStore = vi.hoisted(() => ({
  job: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  application: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  deletedJobUrl: {
    upsert: vi.fn(),
    createMany: vi.fn(),
  },
  applicationBatch: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  applicationBatchTask: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    groupBy: vi.fn(),
  },
  executeRaw: vi.fn(),
  queryRaw: vi.fn(),
  transaction: vi.fn(),
  operations: [] as string[],
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: { $transaction: prismaStore.transaction },
}));
const artifactStore = vi.hoisted(() => ({
  enqueue: vi.fn(),
}));
vi.mock("@/lib/server/artifacts/applicationArtifactLifecycle", () => ({
  enqueueApplicationArtifactRetirements: artifactStore.enqueue,
  canonicalizeApplicationArtifactStorageIdentity: (value: string) => {
    const parsed = new URL(value.trim());
    const pathname = decodeURIComponent(parsed.pathname).replace(/^\/+/, "");
    return {
      storeHost: parsed.hostname.toLowerCase(),
      pathname,
      key: `${parsed.hostname.toLowerCase()}/${pathname}`,
    };
  },
}));
const blobDelete = vi.hoisted(() => vi.fn());
vi.mock("@vercel/blob", () => ({ del: blobDelete }));
const applicationLock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/applications/applicationMutationLock", () => ({
  acquireApplicationMutationLock: applicationLock,
}));

import { batchDeleteJobs, deleteJob } from "@/lib/server/jobs/jobDeleteService";

describe("jobDeleteService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    blobDelete.mockReset().mockRejectedValue(new Error("Blob unavailable"));
    prismaStore.operations.length = 0;
    artifactStore.enqueue
      .mockReset()
      .mockImplementation(
        async (
          _tx,
          input: { artifacts: Array<{ target: string; url: string }> },
        ) => {
          prismaStore.operations.push("artifact.enqueue");
          return {
            queued: new Set(input.artifacts.map((artifact) => artifact.url))
              .size,
          };
        },
      );
    applicationLock
      .mockReset()
      .mockImplementation(async (_tx, _userId, jobId: string) => {
        prismaStore.operations.push(`application.lock:${jobId}`);
      });

    prismaStore.executeRaw.mockImplementation(async () => {
      prismaStore.operations.push("lock");
      return 0;
    });
    prismaStore.queryRaw.mockImplementation(async () => {
      prismaStore.operations.push("job.lockRows");
      return [];
    });
    prismaStore.job.findFirst.mockImplementation(async () => {
      prismaStore.operations.push("job.findFirst");
      return null;
    });
    prismaStore.job.findMany.mockImplementation(async () => {
      prismaStore.operations.push("job.findMany");
      return [];
    });
    prismaStore.job.deleteMany.mockImplementation(async () => {
      prismaStore.operations.push("job.deleteMany");
      return { count: 1 };
    });
    prismaStore.application.findUnique.mockImplementation(async () => {
      prismaStore.operations.push("application.findUnique");
      return null;
    });
    prismaStore.application.findMany.mockImplementation(async () => {
      prismaStore.operations.push("application.findMany");
      return [];
    });
    prismaStore.application.deleteMany.mockImplementation(async () => {
      prismaStore.operations.push("application.deleteMany");
      return { count: 1 };
    });
    prismaStore.deletedJobUrl.upsert.mockImplementation(async () => {
      prismaStore.operations.push("deletedJobUrl.upsert");
      return {};
    });
    prismaStore.deletedJobUrl.createMany.mockImplementation(async () => {
      prismaStore.operations.push("deletedJobUrl.createMany");
      return { count: 1 };
    });
    prismaStore.applicationBatch.findFirst.mockImplementation(async () => {
      prismaStore.operations.push("applicationBatch.findFirst");
      return null;
    });
    prismaStore.applicationBatch.update.mockImplementation(async () => {
      prismaStore.operations.push("applicationBatch.update");
      return {};
    });
    prismaStore.applicationBatchTask.findMany.mockImplementation(async () => {
      prismaStore.operations.push("applicationBatchTask.findMany");
      return [];
    });
    prismaStore.applicationBatchTask.findFirst.mockImplementation(async () => {
      prismaStore.operations.push("applicationBatchTask.findFirst");
      return null;
    });
    prismaStore.applicationBatchTask.groupBy.mockImplementation(async () => {
      prismaStore.operations.push("applicationBatchTask.groupBy");
      return [];
    });
    prismaStore.transaction.mockImplementation(async (callback) =>
      callback({
        $executeRaw: prismaStore.executeRaw,
        $queryRaw: prismaStore.queryRaw,
        job: prismaStore.job,
        application: prismaStore.application,
        deletedJobUrl: prismaStore.deletedJobUrl,
        applicationBatch: prismaStore.applicationBatch,
        applicationBatchTask: prismaStore.applicationBatchTask,
      }),
    );
  });

  describe("deleteJob", () => {
    it("takes the per-user lock before checking ownership", async () => {
      const result = await deleteJob("user-1", "job-1");

      expect(result).toEqual({ alreadyDeleted: true });
      expect(prismaStore.transaction).toHaveBeenCalledTimes(1);
      expect(prismaStore.operations).toEqual(["lock", "job.findFirst"]);
    });

    it("locks, writes the tombstone, then deletes atomically", async () => {
      prismaStore.job.findFirst.mockImplementationOnce(async () => {
        prismaStore.operations.push("job.findFirst");
        return {
          id: "job-1",
          jobUrl: "https://example.com/jobs/1?ref=x",
        };
      });

      await deleteJob("user-1", "job-1");

      expect(prismaStore.operations).toEqual([
        "lock",
        "job.findFirst",
        "application.lock:job-1",
        "job.lockRows",
        "application.findUnique",
        "deletedJobUrl.upsert",
        "application.deleteMany",
        "job.deleteMany",
      ]);
      expect(prismaStore.job.deleteMany).toHaveBeenCalledWith({
        where: { id: "job-1", userId: "user-1" },
      });
      expect(prismaStore.deletedJobUrl.upsert).toHaveBeenCalledWith({
        where: {
          userId_jobUrl: {
            userId: "user-1",
            jobUrl: "https://example.com/jobs/1",
          },
        },
        update: {},
        create: {
          userId: "user-1",
          jobUrl: "https://example.com/jobs/1",
        },
      });
    });

    it("stays idempotent if the row disappears before its guarded delete", async () => {
      prismaStore.job.findFirst.mockResolvedValueOnce({
        id: "job-1",
        jobUrl: "https://example.com/jobs/1",
      });
      prismaStore.job.deleteMany.mockResolvedValueOnce({ count: 0 });

      await expect(deleteJob("user-1", "job-1")).resolves.toEqual({
        alreadyDeleted: true,
      });
    });

    it("scopes the lookup to the owning user", async () => {
      await deleteJob("user-9", "job-1");

      expect(prismaStore.job.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "job-1", userId: "user-9" },
        }),
      );
      expect(prismaStore.operations[0]).toBe("lock");
    });

    it("queues retirement without requiring a Blob token or port", async () => {
      delete process.env.BLOB_READ_WRITE_TOKEN;
      prismaStore.job.findFirst.mockResolvedValueOnce({
        id: "job-1",
        jobUrl: "https://e.com/1",
      });
      prismaStore.application.findUnique.mockResolvedValueOnce({
        id: "application-1",
        jobId: "job-1",
        resumeTexUrl: null,
        resumePdfUrl: "https://blob/cv.pdf",
        coverTexUrl: null,
        coverPdfUrl: null,
      });
      const result = await deleteJob("user-1", "job-1");

      expect(artifactStore.enqueue).toHaveBeenCalledWith(expect.anything(), {
        userId: "user-1",
        jobId: "job-1",
        applicationId: "application-1",
        artifacts: [{ target: "RESUME_PDF", url: "https://blob/cv.pdf" }],
      });
      expect(prismaStore.operations).toEqual(
        expect.arrayContaining([
          "artifact.enqueue",
          "application.deleteMany",
          "job.deleteMany",
        ]),
      );
      expect(prismaStore.operations.indexOf("artifact.enqueue")).toBeLessThan(
        prismaStore.operations.indexOf("application.deleteMany"),
      );
      expect(blobDelete).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        alreadyDeleted: false,
        artifactRetirement: { queued: 1 },
        blobCleanup: { attempted: 1, deleted: 0, failed: 0 },
      });
    });

  });

  describe("batchDeleteJobs", () => {
    it("reports all notFound after checking under the lock", async () => {
      const result = await batchDeleteJobs("user-1", ["a", "b", "c"]);

      expect(result).toEqual({
        deleted: 0,
        notFound: 3,
        artifactRetirement: { queued: 0 },
        blobCleanup: { attempted: 0, deleted: 0, failed: 0 },
      });
      expect(prismaStore.operations).toEqual(["lock", "job.findMany"]);
    });

    it("locks first, tombstones, deletes, and counts notFound", async () => {
      prismaStore.job.findMany.mockImplementationOnce(async () => {
        prismaStore.operations.push("job.findMany");
        return [
          { id: "a", jobUrl: "https://e.com/a" },
          { id: "b", jobUrl: "https://e.com/b" },
        ];
      });
      prismaStore.job.deleteMany.mockImplementationOnce(async () => {
        prismaStore.operations.push("job.deleteMany");
        return { count: 2 };
      });

      const result = await batchDeleteJobs("user-1", ["a", "b", "missing"]);

      expect(prismaStore.operations).toEqual([
        "lock",
        "job.findMany",
        "application.lock:a",
        "application.lock:b",
        "job.lockRows",
        "application.findMany",
        "deletedJobUrl.createMany",
        "application.deleteMany",
        "job.deleteMany",
      ]);
      expect(result).toMatchObject({ deleted: 2, notFound: 1 });
    });

    it("takes application locks in stable job-id order before reading artifacts", async () => {
      prismaStore.job.findMany.mockImplementationOnce(async () => {
        prismaStore.operations.push("job.findMany");
        return [
          { id: "z-job", jobUrl: "https://e.com/z" },
          { id: "a-job", jobUrl: "https://e.com/a" },
        ];
      });
      prismaStore.job.deleteMany.mockResolvedValueOnce({ count: 2 });

      await batchDeleteJobs("user-1", ["z-job", "a-job"]);

      // One step shorter: the Application Batch lock went with the queue.
      expect(prismaStore.operations.slice(0, 6)).toEqual([
        "lock",
        "job.findMany",
        "application.lock:a-job",
        "application.lock:z-job",
        "job.lockRows",
        "application.findMany",
      ]);
    });

    it("deduplicates repeated ids before counting and deleting", async () => {
      prismaStore.job.findMany.mockResolvedValueOnce([
        { id: "a", jobUrl: "https://e.com/a" },
      ]);

      const result = await batchDeleteJobs("user-1", ["a", "a"]);

      expect(prismaStore.job.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ["a"] }, userId: "user-1" },
        }),
      );
      expect(result).toMatchObject({ deleted: 1, notFound: 0 });
    });

    it("queues all application artifacts before deletion for asynchronous drain", async () => {
      prismaStore.job.findMany.mockResolvedValueOnce([
        { id: "a", jobUrl: "https://e.com/a" },
      ]);
      prismaStore.application.findMany.mockResolvedValueOnce([
        {
          id: "application-a",
          jobId: "a",
          resumeTexUrl: "https://blob/cv.tex",
          resumePdfUrl: "https://blob/cv.pdf",
          coverTexUrl: "https://blob/cover.tex",
          coverPdfUrl: "https://blob/cover.pdf",
        },
      ]);
      const result = await batchDeleteJobs("user-1", ["a"]);

      expect(artifactStore.enqueue).toHaveBeenCalledWith(expect.anything(), {
        userId: "user-1",
        jobId: "a",
        applicationId: "application-a",
        artifacts: [
          { target: "RESUME_PDF", url: "https://blob/cv.pdf" },
          { target: "COVER_PDF", url: "https://blob/cover.pdf" },
          { target: "RESUME_TEX", url: "https://blob/cv.tex" },
          { target: "COVER_TEX", url: "https://blob/cover.tex" },
        ],
      });
      expect(prismaStore.operations.indexOf("artifact.enqueue")).toBeLessThan(
        prismaStore.operations.indexOf("application.deleteMany"),
      );
      expect(result.blobCleanup).toEqual({
        attempted: 4,
        deleted: 0,
        failed: 0,
      });
      expect(result.artifactRetirement).toEqual({ queued: 4 });
    });

    it("does not contact Blob while deleting database rows", async () => {
      prismaStore.job.findMany.mockResolvedValueOnce([
        { id: "a", jobUrl: "https://e.com/a" },
      ]);
      prismaStore.application.findMany.mockResolvedValueOnce([
        {
          id: "application-a",
          jobId: "a",
          resumeTexUrl: null,
          resumePdfUrl: "https://blob/cv.pdf",
          coverTexUrl: null,
          coverPdfUrl: "https://blob/cover.pdf",
        },
      ]);
      const result = await batchDeleteJobs("user-1", ["a"]);

      expect(artifactStore.enqueue).toHaveBeenCalledTimes(1);
      expect(blobDelete).not.toHaveBeenCalled();
      expect(prismaStore.application.deleteMany).toHaveBeenCalledTimes(1);
      expect(prismaStore.job.deleteMany).toHaveBeenCalledTimes(1);
      expect(result.blobCleanup).toEqual({
        attempted: 2,
        deleted: 0,
        failed: 0,
      });
      expect(result.artifactRetirement).toEqual({ queued: 2 });
    });

    it("deduplicates shared artifact URLs across a batch before enqueue", async () => {
      prismaStore.job.findMany.mockResolvedValueOnce([
        { id: "a", jobUrl: "https://e.com/a" },
        { id: "b", jobUrl: "https://e.com/b" },
      ]);
      prismaStore.job.deleteMany.mockResolvedValueOnce({ count: 2 });
      prismaStore.application.findMany.mockResolvedValueOnce([
        {
          id: "application-a",
          jobId: "a",
          resumeTexUrl: null,
          resumePdfUrl: "https://blob/shared.pdf?download=1",
          coverTexUrl: null,
          coverPdfUrl: null,
        },
        {
          id: "application-b",
          jobId: "b",
          resumeTexUrl: null,
          resumePdfUrl: "https://blob/shared.pdf",
          coverTexUrl: null,
          coverPdfUrl: "https://blob/unique-cover.pdf",
        },
      ]);
      const result = await batchDeleteJobs("user-1", ["a", "b"]);

      expect(artifactStore.enqueue).toHaveBeenCalledTimes(2);
      expect(artifactStore.enqueue.mock.calls[0]?.[1].artifacts).toEqual([
        {
          target: "RESUME_PDF",
          url: "https://blob/shared.pdf?download=1",
        },
      ]);
      expect(artifactStore.enqueue.mock.calls[1]?.[1].artifacts).toEqual([
        { target: "COVER_PDF", url: "https://blob/unique-cover.pdf" },
      ]);
      expect(result.blobCleanup).toEqual({
        attempted: 2,
        deleted: 0,
        failed: 0,
      });
      expect(result.artifactRetirement).toEqual({ queued: 2 });
    });
  });
});
