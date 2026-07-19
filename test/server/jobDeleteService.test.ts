import { beforeEach, describe, expect, it, vi } from "vitest";

// Tag the ops each builder returns so we can assert the exact order they're
// handed to $transaction — the tombstone (DeletedJobUrl) write MUST be in the
// same atomic transaction as, and ordered before, the job delete, so a
// concurrent re-import can never resurrect a just-deleted role.
const prismaStore = vi.hoisted(() => ({
  job: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    deleteMany: vi.fn(() => ({ __op: "job.deleteMany", __result: { count: 1 } })),
  },
  application: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    deleteMany: vi.fn(() => ({ __op: "application.deleteMany" })),
  },
  deletedJobUrl: {
    upsert: vi.fn(() => ({ __op: "deletedJobUrl.upsert" })),
    createMany: vi.fn(() => ({ __op: "deletedJobUrl.createMany" })),
  },
  $transaction: vi.fn(async (ops: Array<{ __result?: unknown }>) =>
    ops.map((op) => op.__result ?? op),
  ),
}));

vi.mock("@/lib/server/prisma", () => ({ prisma: prismaStore }));
const blobDel = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock("@vercel/blob", () => ({ del: blobDel }));

import { deleteJob, batchDeleteJobs } from "@/lib/server/jobs/jobDeleteService";

describe("jobDeleteService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.BLOB_READ_WRITE_TOKEN;
  });

  describe("deleteJob", () => {
    it("returns alreadyDeleted when the job is not owned/found", async () => {
      prismaStore.job.findFirst.mockResolvedValue(null);
      const result = await deleteJob("user-1", "job-1");
      expect(result).toEqual({ alreadyDeleted: true });
      expect(prismaStore.$transaction).not.toHaveBeenCalled();
    });

    it("writes the tombstone before deleting the job, atomically", async () => {
      prismaStore.job.findFirst.mockResolvedValue({
        id: "job-1",
        jobUrl: "https://example.com/jobs/1?ref=x",
      });
      prismaStore.application.findUnique.mockResolvedValue(null);

      await deleteJob("user-1", "job-1");

      expect(prismaStore.$transaction).toHaveBeenCalledTimes(1);
      const ops = prismaStore.$transaction.mock.calls[0][0] as Array<{ __op: string }>;
      expect(ops.map((o) => o.__op)).toEqual([
        "deletedJobUrl.upsert",
        "application.deleteMany",
        "job.deleteMany",
      ]);
      expect(prismaStore.job.deleteMany).toHaveBeenCalledWith({
        where: { id: "job-1", userId: "user-1" },
      });
    });

    it("stays idempotent when another request deletes the job after lookup", async () => {
      prismaStore.job.findFirst.mockResolvedValue({
        id: "job-1",
        jobUrl: "https://example.com/jobs/1",
      });
      prismaStore.application.findUnique.mockResolvedValue(null);
      prismaStore.job.deleteMany.mockReturnValueOnce({
        __op: "job.deleteMany",
        __result: { count: 0 },
      });

      await expect(deleteJob("user-1", "job-1")).resolves.toEqual({
        alreadyDeleted: true,
      });
    });

    it("scopes the lookup to the owning user", async () => {
      prismaStore.job.findFirst.mockResolvedValue(null);
      await deleteJob("user-9", "job-1");
      expect(prismaStore.job.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "job-1", userId: "user-9" },
        }),
      );
    });

    it("skips blob cleanup when no token is configured", async () => {
      prismaStore.job.findFirst.mockResolvedValue({ id: "job-1", jobUrl: "https://e.com/1" });
      prismaStore.application.findUnique.mockResolvedValue({
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
    it("reports all notFound when nothing matches", async () => {
      prismaStore.job.findMany.mockResolvedValue([]);
      const result = await batchDeleteJobs("user-1", ["a", "b", "c"]);
      expect(result).toEqual({
        deleted: 0,
        notFound: 3,
        blobCleanup: { attempted: 0, deleted: 0, failed: 0 },
      });
      expect(prismaStore.$transaction).not.toHaveBeenCalled();
    });

    it("tombstones in the same transaction and counts notFound", async () => {
      prismaStore.job.findMany.mockResolvedValue([
        { id: "a", jobUrl: "https://e.com/a" },
        { id: "b", jobUrl: "https://e.com/b" },
      ]);
      prismaStore.application.findMany.mockResolvedValue([]);
      prismaStore.job.deleteMany.mockReturnValueOnce({
        __op: "job.deleteMany",
        __result: { count: 2 },
      });

      const result = await batchDeleteJobs("user-1", ["a", "b", "missing"]);

      const ops = prismaStore.$transaction.mock.calls[0][0] as Array<{ __op: string }>;
      expect(ops.map((o) => o.__op)).toEqual([
        "deletedJobUrl.createMany",
        "application.deleteMany",
        "job.deleteMany",
      ]);
      expect(result.deleted).toBe(2);
      expect(result.notFound).toBe(1);
    });

    it("deduplicates repeated ids before counting and deleting", async () => {
      prismaStore.job.findMany.mockResolvedValue([
        { id: "a", jobUrl: "https://e.com/a" },
      ]);
      prismaStore.application.findMany.mockResolvedValue([]);
      prismaStore.job.deleteMany.mockReturnValueOnce({
        __op: "job.deleteMany",
        __result: { count: 1 },
      });

      const result = await batchDeleteJobs("user-1", ["a", "a"]);

      expect(prismaStore.job.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: ["a"] }, userId: "user-1" } }),
      );
      expect(result).toMatchObject({ deleted: 1, notFound: 0 });
    });

    it("deletes all application artifacts in one Blob request", async () => {
      process.env.BLOB_READ_WRITE_TOKEN = "blob-token";
      prismaStore.job.findMany.mockResolvedValue([
        { id: "a", jobUrl: "https://e.com/a" },
      ]);
      prismaStore.application.findMany.mockResolvedValue([
        {
          resumeTexUrl: "https://blob/cv.tex",
          resumePdfUrl: "https://blob/cv.pdf",
          coverTexUrl: "https://blob/cover.tex",
          coverPdfUrl: "https://blob/cover.pdf",
        },
      ]);
      prismaStore.job.deleteMany.mockReturnValueOnce({
        __op: "job.deleteMany",
        __result: { count: 1 },
      });

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
      expect(result.blobCleanup).toEqual({ attempted: 4, deleted: 4, failed: 0 });
    });

    it("falls back to bounded per-object cleanup when the bulk Blob call fails", async () => {
      process.env.BLOB_READ_WRITE_TOKEN = "blob-token";
      prismaStore.job.findMany.mockResolvedValue([
        { id: "a", jobUrl: "https://e.com/a" },
      ]);
      prismaStore.application.findMany.mockResolvedValue([
        {
          resumeTexUrl: null,
          resumePdfUrl: "https://blob/cv.pdf",
          coverTexUrl: null,
          coverPdfUrl: "https://blob/cover.pdf",
        },
      ]);
      prismaStore.job.deleteMany.mockReturnValueOnce({
        __op: "job.deleteMany",
        __result: { count: 1 },
      });
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
