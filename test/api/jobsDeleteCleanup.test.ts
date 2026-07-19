import { beforeEach, describe, expect, it, vi } from "vitest";

const jobStore = vi.hoisted(() => ({
  findFirst: vi.fn(),
  deleteMany: vi.fn(),
}));

const deletedJobUrlStore = vi.hoisted(() => ({
  upsert: vi.fn(),
}));

const applicationStore = vi.hoisted(() => ({
  findUnique: vi.fn(),
  deleteMany: vi.fn(),
}));

const prismaStore = vi.hoisted(() => ({
  $transaction: vi.fn(),
}));

const blobStore = vi.hoisted(() => ({
  del: vi.fn(),
}));

vi.mock("@vercel/blob", () => ({
  put: vi.fn(),
  del: blobStore.del,
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    job: jobStore,
    deletedJobUrl: deletedJobUrlStore,
    application: applicationStore,
    $transaction: prismaStore.$transaction,
  },
}));

vi.mock("@/auth", () => ({
  authOptions: {},
}));

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

import { getServerSession } from "next-auth/next";
import { DELETE } from "@/app/api/jobs/[id]/route";

const JOB_ID = "550e8400-e29b-41d4-a716-446655440000";

describe("jobs delete api cleanup", () => {
  beforeEach(() => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockReset();
    jobStore.findFirst.mockReset();
    jobStore.deleteMany.mockReset();
    deletedJobUrlStore.upsert.mockReset();
    applicationStore.findUnique.mockReset();
    applicationStore.deleteMany.mockReset();
    prismaStore.$transaction.mockReset();
    blobStore.del.mockReset();
    prismaStore.$transaction.mockImplementation(async (ops: Array<Promise<unknown>>) =>
      Promise.all(ops),
    );
  });

  it("deletes job and removes linked blob artifacts", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "token";
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    jobStore.findFirst.mockResolvedValueOnce({
      id: JOB_ID,
      jobUrl: "https://www.linkedin.com/jobs/view/1/?tracking=abc",
    });
    applicationStore.findUnique.mockResolvedValueOnce({
      resumePdfUrl: "https://blob.vercel-storage.com/r1.pdf",
      coverPdfUrl: "https://blob.vercel-storage.com/c1.pdf",
      resumeTexUrl: null,
      coverTexUrl: null,
    });
    deletedJobUrlStore.upsert.mockResolvedValueOnce({ id: "deleted-url-1" });
    applicationStore.deleteMany.mockResolvedValueOnce({ count: 1 });
    jobStore.deleteMany.mockResolvedValueOnce({ count: 1 });
    blobStore.del.mockResolvedValue(undefined);

    const res = await DELETE(
      new Request(`http://localhost/api/jobs/${JOB_ID}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: JOB_ID }) },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(applicationStore.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1", jobId: JOB_ID },
    });
    expect(blobStore.del).toHaveBeenCalledTimes(1);
    expect(blobStore.del).toHaveBeenCalledWith(
      [
        "https://blob.vercel-storage.com/r1.pdf",
        "https://blob.vercel-storage.com/c1.pdf",
      ],
      { token: "token" },
    );
  });
});
