import { beforeEach, describe, expect, it, vi } from "vitest";

const sessionMock = vi.hoisted(() => ({ require: vi.fn() }));
const jobStore = vi.hoisted(() => ({
  count: vi.fn(),
  findMany: vi.fn(),
  updateMany: vi.fn(),
  updateManyAndReturn: vi.fn(),
}));
const txMock = vi.hoisted(() => ({ transaction: vi.fn(), executeRaw: vi.fn() }));
const profileMock = vi.hoisted(() => ({ get: vi.fn() }));
const applicationEventMock = vi.hoisted(() => ({
  bulkAppendStatusEvents: vi.fn(),
}));

vi.mock("@/lib/server/auth/requireSession", () => {
  class UnauthorizedError extends Error {}
  return { UnauthorizedError, requireSession: sessionMock.require };
});

vi.mock("@/lib/server/prisma", () => ({
  prisma: { job: jobStore, $transaction: txMock.transaction },
}));

vi.mock("@/lib/server/resumeProfile", () => ({
  getResumeProfile: profileMock.get,
}));

vi.mock("@/lib/server/applications/applicationEvents", () => ({
  bulkAppendStatusEvents: applicationEventMock.bulkAppendStatusEvents,
}));

vi.mock("@/lib/server/ai/resumePromptSnapshot", () => ({
  buildResumePromptSnapshot: (profile: unknown) => profile,
}));

import { POST as runPOST } from "@/app/api/jobs/fit/run/route";
import { POST as cancelFitPOST } from "@/app/api/jobs/fit/cancel/route";
import { POST as nextBatchPOST } from "@/app/api/jobs/fit/next-batch/route";
import { POST as markFailedPOST } from "@/app/api/jobs/fit/mark-failed/route";
import { POST as releaseBatchPOST } from "@/app/api/jobs/fit/release-batch/route";
import { POST as bulkIgnorePOST } from "@/app/api/jobs/bulk-ignore/route";
import { UnauthorizedError } from "@/lib/server/auth/requireSession";

const JOB_A = "11111111-1111-4111-8111-111111111111";
const JOB_B = "22222222-2222-4222-8222-222222222222";

function post(url: string, body?: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("fit scoring center apis", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionMock.require.mockResolvedValue({ userId: "user-1" });
    txMock.executeRaw.mockResolvedValue(0);
    txMock.transaction.mockImplementation(async (input: unknown) => {
      if (typeof input === "function") {
        return input({ job: jobStore, $executeRaw: txMock.executeRaw });
      }
      return Promise.all(input as Promise<unknown>[]);
    });
    jobStore.updateMany.mockResolvedValue({ count: 0 });
    jobStore.updateManyAndReturn.mockResolvedValue([]);
    applicationEventMock.bulkAppendStatusEvents.mockResolvedValue({ count: 0 });
    profileMock.get.mockImplementation(
      async (_userId: string, options?: { locale?: string }) =>
        options?.locale === "zh-CN"
          ? null
          : {
              skills: "TypeScript React Node.js PostgreSQL AWS",
              updatedAt: new Date("2026-07-20T00:00:00.000Z"),
            },
    );
  });

  it("run prescreens obvious mismatches across the whole database and reports stats", async () => {
    jobStore.findMany.mockResolvedValueOnce([
      // Gazetteer-heavy JD with zero overlap against the resume text.
      { id: JOB_A, description: "Requires Java, Spring Boot, Kafka, Scala, Hibernate, Kubernetes, Terraform and Jenkins.", market: "AU" },
      // Overlapping JD stays for the AI pump.
      { id: JOB_B, description: "TypeScript, React, Node.js and AWS for a product team.", market: "AU" },
    ]);
    jobStore.updateMany
      .mockResolvedValueOnce({ count: 2 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 3 })
      .mockResolvedValueOnce({ count: 1 });
    txMock.transaction.mockImplementation(async (ops: unknown[]) =>
      Promise.all(ops as Promise<unknown>[]),
    );
    // Stats after prescreen: 10 NEW total, 1 still pending.
    jobStore.count.mockResolvedValueOnce(10).mockResolvedValueOnce(1);

    const response = await runPOST();
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      total: 10,
      pending: 1,
      scored: 9,
      prescreened: 1,
      invalidated: 2,
      retried: 3,
    });
    expect(jobStore.updateMany).toHaveBeenNthCalledWith(3, {
      where: {
        userId: "user-1",
        status: "NEW",
        fitSource: { in: ["failed", "cancelled"] },
      },
      data: expect.objectContaining({ fitSource: null, fitScoredAt: null }),
    });
  });

  it("cancels every pending or claimed fit job and returns terminal no-store stats", async () => {
    jobStore.updateMany.mockResolvedValueOnce({ count: 3 });
    jobStore.count.mockResolvedValueOnce(10).mockResolvedValueOnce(0);

    const response = await cancelFitPOST();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    await expect(response.json()).resolves.toEqual({
      cancelled: 3,
      total: 10,
      scored: 10,
      pending: 0,
    });
    expect(txMock.executeRaw).toHaveBeenCalledTimes(1);
    expect(jobStore.updateMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        status: "NEW",
        fitScoredAt: null,
      },
      data: expect.objectContaining({
        fitSource: "cancelled",
        fitScoredAt: expect.any(Date),
      }),
    });
  });

  it("keeps fit cancellation session-only", async () => {
    sessionMock.require.mockRejectedValueOnce(new UnauthorizedError());

    const response = await cancelFitPOST();

    expect(response.status).toBe(401);
    expect(jobStore.updateMany).not.toHaveBeenCalled();
    expect(txMock.transaction).not.toHaveBeenCalled();
  });

  it("next-batch serves unscored ids from the database, not from the page", async () => {
    jobStore.findMany.mockResolvedValueOnce([
      { id: JOB_A, market: "AU" },
      { id: JOB_B, market: "GLOBAL" },
    ]);
    jobStore.updateManyAndReturn.mockResolvedValueOnce([{ id: JOB_A }, { id: JOB_B }]);
    jobStore.count
      .mockResolvedValueOnce(7)
      .mockResolvedValueOnce(3);

    const response = await nextBatchPOST(new Request("http://localhost/api/jobs/fit/next-batch", { method: "POST" }));
    const json = await response.json();

    expect(json).toEqual({
      jobIds: [JOB_A, JOB_B],
      remaining: 5,
      pendingTotal: 7,
      leased: 3,
      retryAfterMs: null,
      claimToken: expect.any(String),
    });
    expect(txMock.executeRaw).toHaveBeenCalledTimes(1);
    expect(jobStore.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "user-1",
          status: "NEW",
          fitScoredAt: null,
        }),
        take: 15,
      }),
    );
    expect(jobStore.updateManyAndReturn).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ fitSource: expect.stringMatching(/^claim:/) }),
        select: { id: true },
      }),
    );
  });

  it("never leases CN and English-market jobs into the same AI prompt", async () => {
    jobStore.findMany.mockResolvedValueOnce([
      { id: JOB_A, market: "CN" },
      { id: JOB_B, market: "AU" },
    ]);
    jobStore.updateManyAndReturn.mockResolvedValueOnce([{ id: JOB_A }]);
    jobStore.count.mockResolvedValueOnce(2).mockResolvedValueOnce(1);

    const response = await nextBatchPOST(new Request("http://localhost/api/jobs/fit/next-batch", { method: "POST" }));

    expect(await response.json()).toMatchObject({ jobIds: [JOB_A] });
    expect(jobStore.updateManyAndReturn).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: [JOB_A] } }),
      }),
    );
  });

  it("next-batch reports fresh leased work instead of falsely declaring completion", async () => {
    jobStore.findMany.mockResolvedValueOnce([]);
    jobStore.count
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(2);

    const response = await nextBatchPOST(new Request("http://localhost/api/jobs/fit/next-batch", { method: "POST" }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      jobIds: [],
      remaining: 2,
      pendingTotal: 2,
      leased: 2,
      retryAfterMs: 5_000,
      claimToken: null,
    });
    expect(jobStore.count).toHaveBeenNthCalledWith(1, {
      where: {
        userId: "user-1",
        status: "NEW",
        fitScoredAt: null,
      },
    });
    expect(jobStore.count).toHaveBeenNthCalledWith(2, {
      where: {
        userId: "user-1",
        status: "NEW",
        fitScoredAt: null,
        fitSource: { startsWith: "claim:" },
        updatedAt: { gte: expect.any(Date) },
      },
    });
  });

  it("next-batch declares completion only when no pending or leased jobs remain", async () => {
    jobStore.findMany.mockResolvedValueOnce([]);
    jobStore.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    const response = await nextBatchPOST(new Request("http://localhost/api/jobs/fit/next-batch", { method: "POST" }));

    expect(await response.json()).toEqual({
      jobIds: [],
      remaining: 0,
      pendingTotal: 0,
      leased: 0,
      retryAfterMs: null,
      claimToken: null,
    });
  });

  it("mark-failed dequeues only unscored jobs of this user", async () => {
    jobStore.updateMany.mockResolvedValueOnce({ count: 2 });
    const claimToken = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const response = await markFailedPOST(post("http://localhost/api/jobs/fit/mark-failed", {
      jobIds: [JOB_A, JOB_B],
      claimToken,
    }));
    expect(await response.json()).toEqual({ count: 2 });
    expect(jobStore.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { in: [JOB_A, JOB_B] },
          userId: "user-1",
          status: "NEW",
          fitScoredAt: null,
          fitSource: `claim:${claimToken}`,
        },
        data: expect.objectContaining({ fitSource: "failed" }),
      }),
    );
  });

  it("releases only the caller's active claim when a scan is cancelled", async () => {
    const claimToken = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    jobStore.updateMany.mockResolvedValueOnce({ count: 2 });

    const response = await releaseBatchPOST(post(
      "http://localhost/api/jobs/fit/release-batch",
      { jobIds: [JOB_A, JOB_B], claimToken },
    ));

    expect(await response.json()).toEqual({ count: 2 });
    expect(jobStore.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: [JOB_A, JOB_B] },
        userId: "user-1",
        status: "NEW",
        fitScoredAt: null,
        fitSource: `claim:${claimToken}`,
      },
      data: { fitSource: null },
    });
  });

  it("bulk-ignore previews, sweeps only scored low-fit NEW jobs, and restores on undo", async () => {
    jobStore.count.mockResolvedValueOnce(3);
    const preview = await bulkIgnorePOST(post("http://localhost/api/jobs/bulk-ignore", { maxScore: 44, preview: true }));
    expect(await preview.json()).toEqual({ count: 3 });

    applicationEventMock.bulkAppendStatusEvents.mockResolvedValueOnce({
      count: 2,
    });
    const sweep = await bulkIgnorePOST(post("http://localhost/api/jobs/bulk-ignore", { maxScore: 44 }));
    const sweepBody = await sweep.json();
    expect(sweepBody).toEqual({
      count: 2,
      ignoredAt: expect.any(String),
    });
    expect(applicationEventMock.bulkAppendStatusEvents).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "user-1",
          status: "NEW",
          fitScore: { not: null, lte: 44 },
          OR: [
            {
              market: { in: ["AU", "GLOBAL"] },
              fitSnapshotHash: "2026-07-20T00:00:00.000Z",
            },
          ],
        }),
        fromStatus: "NEW",
        toStatus: "REJECTED",
        source: "USER",
        projectionUpdatedAt: expect.any(Date),
      }),
    );

    applicationEventMock.bulkAppendStatusEvents.mockResolvedValueOnce({
      count: 2,
    });
    const restore = await bulkIgnorePOST(post("http://localhost/api/jobs/bulk-ignore", {
      restoreIgnoredAt: sweepBody.ignoredAt,
      maxScore: 44,
    }));
    expect(await restore.json()).toEqual({ restored: 2 });
    expect(applicationEventMock.bulkAppendStatusEvents).toHaveBeenLastCalledWith(
      "user-1",
      expect.objectContaining({
        where: {
        fitScore: { not: null, lte: 44 },
        updatedAt: new Date(sweepBody.ignoredAt),
      },
        fromStatus: "REJECTED",
        toStatus: "NEW",
        source: "USER",
      }),
    );
  });

  it("rejects a bulk-ignore threshold above the WEAK/POOR boundary", async () => {
    const response = await bulkIgnorePOST(post("http://localhost/api/jobs/bulk-ignore", { maxScore: 80 }));
    expect(response.status).toBe(400);
  });

  it("never bulk-ignores scores when no current resume snapshot exists", async () => {
    profileMock.get.mockResolvedValue(null);

    const response = await bulkIgnorePOST(
      post("http://localhost/api/jobs/bulk-ignore", {
        maxScore: 44,
        preview: true,
      }),
    );

    expect(await response.json()).toEqual({ count: 0 });
    expect(jobStore.count).not.toHaveBeenCalled();
    expect(
      applicationEventMock.bulkAppendStatusEvents,
    ).not.toHaveBeenCalled();
  });
});
