import { beforeEach, describe, expect, it, vi } from "vitest";

const applicationBatchStore = vi.hoisted(() => ({
  findFirst: vi.fn(),
}));

const applicationBatchTaskStore = vi.hoisted(() => ({
  groupBy: vi.fn(),
  findMany: vi.fn(),
}));

const applicationStore = vi.hoisted(() => ({
  findMany: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    applicationBatch: applicationBatchStore,
    applicationBatchTask: applicationBatchTaskStore,
    application: applicationStore,
  },
}));

vi.mock("@/auth", () => ({
  authOptions: {},
}));

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

import { getServerSession } from "next-auth/next";
import { GET } from "@/app/api/application-batches/[id]/summary/route";

const BATCH_ID = "550e8400-e29b-41d4-a716-446655440000";

const editableAiContent = {
  schemaVersion: 1,
  generatedAt: "2026-08-10T00:00:00.000Z",
  promptMetaHash: "prompt-hash",
  cv: {
    summary: {
      aiText: "do-not-leak-this-summary",
      originalText: "Engineer.",
      accepted: true,
    },
    latestExperience: { experienceIndex: 0, addedBullets: [] },
  },
  cover: {
    paragraphOne: { aiText: "One", accepted: true },
    paragraphTwo: { aiText: "Two", accepted: true },
    paragraphThree: { aiText: "Three", accepted: true },
  },
};

describe("application batch summary api", () => {
  beforeEach(() => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockReset();
    applicationBatchStore.findFirst.mockReset();
    applicationBatchTaskStore.groupBy.mockReset();
    applicationBatchTaskStore.findMany.mockReset();
    applicationStore.findMany.mockReset();
  });

  it("returns success/failure/remaining summary for codex batch run", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        user: { id: "user-1" },
      },
    );
    applicationBatchStore.findFirst.mockResolvedValueOnce({
      id: BATCH_ID,
      scope: "NEW",
      status: "RUNNING",
      totalCount: 4,
      error: null,
      createdAt: new Date("2026-02-22T10:00:00.000Z"),
      updatedAt: new Date("2026-02-22T10:02:00.000Z"),
      startedAt: new Date("2026-02-22T10:00:10.000Z"),
      completedAt: null,
    });
    applicationBatchTaskStore.groupBy.mockResolvedValueOnce([
      { status: "PENDING", _count: { _all: 1 } },
      { status: "SUCCEEDED", _count: { _all: 2 } },
      { status: "FAILED", _count: { _all: 1 } },
    ]);
    applicationBatchTaskStore.findMany
      .mockResolvedValueOnce([
        {
          id: "task-failed-1",
          jobId: "job-3",
          status: "FAILED",
          error: "PARSE_FAILED",
          attempt: 1,
          updatedAt: new Date("2026-02-22T10:01:00.000Z"),
          job: {
            title: "Backend Engineer",
            company: "Acme",
            jobUrl: "https://example.com/3",
          },
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "task-ok-1",
          jobId: "job-1",
          status: "SUCCEEDED",
          completedAt: new Date("2026-02-22T10:00:40.000Z"),
          job: {
            title: "Frontend Engineer",
            company: "Acme",
            jobUrl: "https://example.com/1",
          },
        },
      ]);
    applicationStore.findMany.mockResolvedValueOnce([
      {
        id: "application-1",
        jobId: "job-1",
        aiContent: editableAiContent,
        resumePdfUrl: "https://blob.vercel-storage.com/r1.pdf",
        coverPdfUrl: "https://blob.vercel-storage.com/c1.pdf",
      },
      {
        id: "application-3",
        jobId: "job-3",
        aiContent: null,
        resumePdfUrl: "https://blob.vercel-storage.com/r3.pdf",
        coverPdfUrl: null,
      },
    ]);

    const res = await GET(
      new Request(
        `http://localhost/api/application-batches/${BATCH_ID}/summary`,
      ),
      { params: Promise.resolve({ id: BATCH_ID }) },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.batch.id).toBe(BATCH_ID);
    expect(json.progress.pending).toBe(1);
    expect(json.progress.succeeded).toBe(2);
    expect(json.progress.failed).toBe(1);
    expect(json.remainingCount).toBe(1);
    expect(json.failed).toHaveLength(1);
    expect(json.failed[0].error).toBe("PARSE_FAILED");
    expect(json.failed[0]).toEqual(
      expect.objectContaining({
        applicationId: null,
        artifacts: {
          resumePdfUrl: "https://blob.vercel-storage.com/r3.pdf",
          coverPdfUrl: null,
        },
      }),
    );
    expect(json.failed[0]).not.toHaveProperty("aiContent");
    expect(json.succeeded).toHaveLength(1);
    expect(json.succeeded[0].applicationId).toBe("application-1");
    expect(json.succeeded[0].artifacts.resumePdfUrl).toContain(
      "vercel-storage",
    );
    expect(JSON.stringify(json)).not.toContain("do-not-leak-this-summary");
    expect(applicationStore.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ aiContent: true }),
      }),
    );
  });

  it("fails closed when terminal tasks reference Jobs outside the session tenant", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        user: { id: "user-1" },
      },
    );
    applicationBatchStore.findFirst.mockResolvedValueOnce({
      id: BATCH_ID,
      scope: "NEW",
      status: "COMPLETED",
      totalCount: 2,
      error: null,
      createdAt: new Date("2026-02-22T10:00:00.000Z"),
      updatedAt: new Date("2026-02-22T10:02:00.000Z"),
      startedAt: new Date("2026-02-22T10:00:10.000Z"),
      completedAt: new Date("2026-02-22T10:02:00.000Z"),
    });
    applicationBatchTaskStore.groupBy.mockImplementationOnce(
      async ({ where }) =>
        where.job?.userId === "user-1"
          ? []
          : [
              { status: "SUCCEEDED", _count: { _all: 1 } },
              { status: "FAILED", _count: { _all: 1 } },
            ],
    );
    applicationBatchTaskStore.findMany
      .mockImplementationOnce(async ({ where }) =>
        where.job?.userId === "user-1"
          ? []
          : [
              {
                id: "task-failed-cross-tenant",
                jobId: "job-other-tenant-1",
                status: "FAILED",
                error: "PARSE_FAILED",
                attempt: 1,
                updatedAt: new Date("2026-02-22T10:01:00.000Z"),
                job: {
                  title: "Private failed role",
                  company: "Other tenant",
                  jobUrl: "https://example.com/private-failed",
                },
              },
            ],
      )
      .mockImplementationOnce(async ({ where }) =>
        where.job?.userId === "user-1"
          ? []
          : [
              {
                id: "task-succeeded-cross-tenant",
                jobId: "job-other-tenant-2",
                status: "SUCCEEDED",
                completedAt: new Date("2026-02-22T10:01:30.000Z"),
                updatedAt: new Date("2026-02-22T10:01:30.000Z"),
                job: {
                  title: "Private succeeded role",
                  company: "Other tenant",
                  jobUrl: "https://example.com/private-succeeded",
                },
              },
            ],
      );
    applicationStore.findMany.mockResolvedValueOnce([]);

    const res = await GET(
      new Request(
        `http://localhost/api/application-batches/${BATCH_ID}/summary`,
      ),
      { params: Promise.resolve({ id: BATCH_ID }) },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.progress).toEqual({
      pending: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
    });
    expect(json.remainingCount).toBe(0);
    expect(json.failed).toEqual([]);
    expect(json.succeeded).toEqual([]);
    expect(applicationStore.findMany).not.toHaveBeenCalled();
  });

  it("fails closed when Application artifact lookup cannot prove current Job ownership", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        user: { id: "user-1" },
      },
    );
    applicationBatchStore.findFirst.mockResolvedValueOnce({
      id: BATCH_ID,
      scope: "NEW",
      status: "COMPLETED",
      totalCount: 1,
      error: null,
      createdAt: new Date("2026-02-22T10:00:00.000Z"),
      updatedAt: new Date("2026-02-22T10:02:00.000Z"),
      startedAt: new Date("2026-02-22T10:00:10.000Z"),
      completedAt: new Date("2026-02-22T10:02:00.000Z"),
    });
    applicationBatchTaskStore.groupBy.mockResolvedValueOnce([
      { status: "SUCCEEDED", _count: { _all: 1 } },
    ]);
    applicationBatchTaskStore.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "task-ok-1",
          jobId: "job-1",
          status: "SUCCEEDED",
          completedAt: new Date("2026-02-22T10:01:30.000Z"),
          updatedAt: new Date("2026-02-22T10:01:30.000Z"),
          job: {
            title: "Frontend Engineer",
            company: "Acme",
            jobUrl: "https://example.com/1",
          },
        },
      ]);
    applicationStore.findMany.mockImplementationOnce(async ({ where }) =>
      where.userId === "user-1" && where.job?.userId === "user-1"
        ? []
        : [
            {
              id: "application-with-unproven-job-owner",
              jobId: "job-1",
              resumePdfUrl: "https://example.com/private-resume.pdf",
              coverPdfUrl: "https://example.com/private-cover.pdf",
            },
          ],
    );

    const res = await GET(
      new Request(
        `http://localhost/api/application-batches/${BATCH_ID}/summary`,
      ),
      { params: Promise.resolve({ id: BATCH_ID }) },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.succeeded).toHaveLength(1);
    expect(json.succeeded[0]).toEqual(
      expect.objectContaining({
        applicationId: null,
        artifacts: {
          resumePdfUrl: null,
          coverPdfUrl: null,
        },
      }),
    );
  });
});
