import { beforeEach, describe, expect, it, vi } from "vitest";

const applicationBatchStore = vi.hoisted(() => ({
  findFirst: vi.fn(),
  create: vi.fn(),
}));

const applicationBatchTaskStore = vi.hoisted(() => ({
  createMany: vi.fn(),
}));

const jobStore = vi.hoisted(() => ({
  findMany: vi.fn(),
}));

const prismaStore = vi.hoisted(() => ({
  $executeRaw: vi.fn(),
  $transaction: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    applicationBatch: applicationBatchStore,
    applicationBatchTask: applicationBatchTaskStore,
    job: jobStore,
    $executeRaw: prismaStore.$executeRaw,
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
import { POST } from "@/app/api/application-batches/route";

describe("application batches create api", () => {
  beforeEach(() => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockReset();
    applicationBatchStore.findFirst.mockReset();
    applicationBatchStore.create.mockReset();
    applicationBatchTaskStore.createMany.mockReset();
    jobStore.findMany.mockReset();
    prismaStore.$executeRaw.mockReset().mockResolvedValue(0);
    prismaStore.$transaction.mockReset();
    prismaStore.$transaction.mockImplementation(
      async (callback: (tx: unknown) => unknown) =>
        callback({
          $executeRaw: prismaStore.$executeRaw,
          applicationBatch: applicationBatchStore,
          applicationBatchTask: applicationBatchTaskStore,
          job: jobStore,
        }),
    );
  });

  it("creates a queued batch for NEW jobs", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        user: { id: "user-1" },
      },
    );
    applicationBatchStore.findFirst.mockResolvedValueOnce(null);
    jobStore.findMany.mockResolvedValueOnce([
      {
        id: "job-1",
        title: "Software Engineer",
        company: "Acme",
        jobUrl: "https://a",
      },
      {
        id: "job-2",
        title: "Frontend Engineer",
        company: "Acme",
        jobUrl: "https://b",
      },
    ]);
    applicationBatchStore.create.mockResolvedValueOnce({
      id: "batch-1",
      status: "QUEUED",
      totalCount: 2,
      createdAt: new Date("2026-02-23T10:00:00.000Z"),
    });
    applicationBatchTaskStore.createMany.mockResolvedValueOnce({ count: 2 });

    const res = await POST(
      new Request("http://localhost/api/application-batches", {
        method: "POST",
        body: JSON.stringify({ scope: "NEW" }),
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.batch.id).toBe("batch-1");
    expect(jobStore.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "user-1",
          market: "AU",
          status: "NEW",
        }),
      }),
    );
    expect(applicationBatchTaskStore.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            userId: "user-1",
            jobId: "job-1",
            status: "PENDING",
          }),
          expect.objectContaining({
            userId: "user-1",
            jobId: "job-2",
            status: "PENDING",
          }),
        ]),
      }),
    );
    expect(prismaStore.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      applicationBatchStore.findFirst.mock.invocationCallOrder[0]!,
    );
  });

  it("returns conflict when an active batch already exists", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        user: { id: "user-1" },
      },
    );
    applicationBatchStore.findFirst.mockResolvedValueOnce({
      id: "batch-existing",
      status: "RUNNING",
    });

    const res = await POST(
      new Request("http://localhost/api/application-batches", {
        method: "POST",
        body: JSON.stringify({ scope: "NEW" }),
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error.code).toBe("ACTIVE_BATCH_EXISTS");
    expect(json.error.details.batchId).toBe("batch-existing");
  });

  it("preserves the NO_ELIGIBLE_JOBS response without persisting an empty header", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        user: { id: "user-1" },
      },
    );
    applicationBatchStore.findFirst.mockResolvedValueOnce(null);
    jobStore.findMany.mockResolvedValueOnce([]);

    const res = await POST(
      new Request("http://localhost/api/application-batches", {
        method: "POST",
        body: JSON.stringify({ scope: "NEW" }),
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error.code).toBe("NO_ELIGIBLE_JOBS");
    expect(applicationBatchStore.create).not.toHaveBeenCalled();
    expect(applicationBatchTaskStore.createMany).not.toHaveBeenCalled();
  });

  it("creates a batch from selected NEW job ids only", async () => {
    const selectedJobIds = [
      "770e8400-e29b-41d4-a716-446655440000",
      "880e8400-e29b-41d4-a716-446655440000",
    ];
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        user: { id: "user-1" },
      },
    );
    applicationBatchStore.findFirst.mockResolvedValueOnce(null);
    jobStore.findMany.mockResolvedValueOnce([
      {
        id: selectedJobIds[0],
        title: "Software Engineer",
        company: "Acme",
        jobUrl: "https://a",
      },
    ]);
    applicationBatchStore.create.mockResolvedValueOnce({
      id: "batch-selected",
      scope: "NEW",
      status: "QUEUED",
      totalCount: 1,
      createdAt: new Date("2026-02-23T10:00:00.000Z"),
    });
    applicationBatchTaskStore.createMany.mockResolvedValueOnce({ count: 1 });

    const res = await POST(
      new Request("http://localhost/api/application-batches", {
        method: "POST",
        body: JSON.stringify({
          scope: "NEW",
          selectedJobIds,
        }),
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.batch.id).toBe("batch-selected");
    expect(jobStore.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "user-1",
          market: "AU",
          status: "NEW",
          id: { in: selectedJobIds },
        }),
      }),
    );
    expect(applicationBatchTaskStore.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            userId: "user-1",
            jobId: selectedJobIds[0],
            status: "PENDING",
          }),
        ],
      }),
    );
  });

  it("maps a concurrent active-batch unique collision to the existing 409 contract", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        user: { id: "user-1" },
      },
    );
    applicationBatchStore.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "batch-winner", status: "QUEUED" });
    jobStore.findMany.mockResolvedValueOnce([{ id: "job-1" }]);
    applicationBatchStore.create.mockRejectedValueOnce({ code: "P2002" });

    const res = await POST(
      new Request("http://localhost/api/application-batches", {
        method: "POST",
        body: JSON.stringify({ scope: "NEW" }),
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toMatchObject({
      code: "ACTIVE_BATCH_EXISTS",
      details: { batchId: "batch-winner", status: "QUEUED" },
    });
    expect(applicationBatchTaskStore.createMany).not.toHaveBeenCalled();
  });
});
