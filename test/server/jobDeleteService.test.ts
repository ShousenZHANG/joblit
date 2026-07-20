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
  executeRaw: vi.fn(),
  transaction: vi.fn(),
  operations: [] as string[],
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: { $transaction: prismaStore.transaction },
}));
const blobDel = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock("@vercel/blob", () => ({ del: blobDel }));
const applicationLock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/applications/applicationMutationLock", () => ({
  acquireApplicationMutationLock: applicationLock,
}));

import {
  batchDeleteJobs,
  deleteJob,
} from "@/lib/server/jobs/jobDeleteService";

describe("jobDeleteService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.BLOB_READ_WRITE_TOKEN;
    prismaStore.operations.length = 0;
    applicationLock.mockReset().mockImplementation(
      async (_tx, _userId, jobId: string) => {
        prismaStore.operations.push(`application.lock:${jobId}`);
      },
    );

    prismaStore.executeRaw.mockImplementation(async () => {
      prismaStore.operations.push("lock");
      return 0;
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
    prismaStore.transaction.mockImplementation(async (callback) =>
      callback({
        $executeRaw: prismaStore.executeRaw,
        job: prismaStore.job,
        application: prismaStore.application,
        deletedJobUrl: prismaStore.deletedJobUrl,
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

    it("reports artifact cleanup failure when Blob token is missing", async () => {
      prismaStore.job.findFirst.mockResolvedValueOnce({
        id: "job-1",
        jobUrl: "https://e.com/1",
      });
      prismaStore.application.findUnique.mockResolvedValueOnce({
        resumePdfUrl: "https://blob/cv.pdf",
      });

      const result = await deleteJob("user-1", "job-1");

      expect(blobDel).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        alreadyDeleted: false,
        blobCleanup: { attempted: 1, deleted: 0, failed: 1 },
      });
    });
  });

  describe("batchDeleteJobs", () => {
    it("reports all notFound after checking under the lock", async () => {
      const result = await batchDeleteJobs("user-1", ["a", "b", "c"]);

      expect(result).toEqual({
        deleted: 0,
        notFound: 3,
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

      const result = await batchDeleteJobs("user-1", [
        "a",
        "b",
        "missing",
      ]);

      expect(prismaStore.operations).toEqual([
        "lock",
        "job.findMany",
        "application.lock:a",
        "application.lock:b",
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

      expect(prismaStore.operations.slice(0, 5)).toEqual([
        "lock",
        "job.findMany",
        "application.lock:a-job",
        "application.lock:z-job",
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

    it("deletes all application artifacts in one Blob request", async () => {
      process.env.BLOB_READ_WRITE_TOKEN = "blob-token";
      prismaStore.job.findMany.mockResolvedValueOnce([
        { id: "a", jobUrl: "https://e.com/a" },
      ]);
      prismaStore.application.findMany.mockResolvedValueOnce([
        {
          resumeTexUrl: "https://blob/cv.tex",
          resumePdfUrl: "https://blob/cv.pdf",
          coverTexUrl: "https://blob/cover.tex",
          coverPdfUrl: "https://blob/cover.pdf",
        },
      ]);

      const result = await batchDeleteJobs("user-1", ["a"]);

      expect(blobDel).toHaveBeenCalledTimes(1);
      expect(blobDel).toHaveBeenCalledWith(
        [
          "https://blob/cv.tex",
          "https://blob/cv.pdf",
          "https://blob/cover.tex",
          "https://blob/cover.pdf",
        ],
        { token: "blob-token" },
      );
      expect(result.blobCleanup).toEqual({
        attempted: 4,
        deleted: 4,
        failed: 0,
      });
    });

    it("falls back to bounded cleanup when bulk Blob delete fails", async () => {
      process.env.BLOB_READ_WRITE_TOKEN = "blob-token";
      prismaStore.job.findMany.mockResolvedValueOnce([
        { id: "a", jobUrl: "https://e.com/a" },
      ]);
      prismaStore.application.findMany.mockResolvedValueOnce([
        {
          resumeTexUrl: null,
          resumePdfUrl: "https://blob/cv.pdf",
          coverTexUrl: null,
          coverPdfUrl: "https://blob/cover.pdf",
        },
      ]);
      blobDel
        .mockRejectedValueOnce(new Error("bulk failed"))
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error("object failed"));

      const result = await batchDeleteJobs("user-1", ["a"]);

      expect(blobDel).toHaveBeenCalledTimes(3);
      expect(result.blobCleanup).toEqual({
        attempted: 2,
        deleted: 1,
        failed: 1,
      });
    });
  });
});
