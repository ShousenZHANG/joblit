import { beforeEach, describe, expect, it, vi } from "vitest";

const sessionMock = vi.hoisted(() => ({ require: vi.fn() }));
const jobStore = vi.hoisted(() => ({
  count: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
  updateMany: vi.fn(),
  updateManyAndReturn: vi.fn(),
}));
const txMock = vi.hoisted(() => ({
  transaction: vi.fn(),
  executeRaw: vi.fn(),
}));
const fitClaimStore = vi.hoisted(() => ({
  findFirst: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
}));
const fitClaimItemStore = vi.hoisted(() => ({ updateMany: vi.fn() }));
const profileMock = vi.hoisted(() => ({ get: vi.fn() }));
const applicationEventMock = vi.hoisted(() => ({
  bulkAppendStatusEvents: vi.fn(),
}));

vi.mock("@/lib/server/auth/requireSession", () => {
  class UnauthorizedError extends Error {}
  return { UnauthorizedError, requireSession: sessionMock.require };
});

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    job: jobStore,
    fitBatchClaim: fitClaimStore,
    fitBatchClaimItem: fitClaimItemStore,
    $transaction: txMock.transaction,
  },
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
import { POST as heartbeatPOST } from "@/app/api/jobs/fit/heartbeat/route";
import { POST as prescreenPOST } from "@/app/api/jobs/fit/prescreen/route";
import { POST as bulkIgnorePOST } from "@/app/api/jobs/bulk-ignore/route";
import { UnauthorizedError } from "@/lib/server/auth/requireSession";
import {
  bindFitBatchPrompt,
  heartbeatFitBatchClaim,
} from "@/lib/server/jobs/fitRunService";

const JOB_A = "11111111-1111-4111-8111-111111111111";
const JOB_B = "22222222-2222-4222-8222-222222222222";
const JOB_UPDATED_AT = new Date("2026-07-19T00:00:00.000Z");

function post(url: string, body?: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("fit scoring center apis", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    sessionMock.require.mockResolvedValue({
      userId: "user-1",
      requestId: "66666666-6666-4666-8666-666666666666",
    });
    txMock.executeRaw.mockResolvedValue(0);
    txMock.transaction.mockImplementation(async (input: unknown) => {
      if (typeof input === "function") {
        return input({
          job: jobStore,
          fitBatchClaim: fitClaimStore,
          fitBatchClaimItem: fitClaimItemStore,
          $executeRaw: txMock.executeRaw,
        });
      }
      return Promise.all(input as Promise<unknown>[]);
    });
    fitClaimStore.findFirst.mockResolvedValue(null);
    fitClaimStore.create.mockResolvedValue({
      id: "99999999-9999-4999-8999-999999999999",
    });
    fitClaimStore.update.mockResolvedValue({});
    fitClaimStore.updateMany.mockResolvedValue({ count: 0 });
    fitClaimItemStore.updateMany.mockResolvedValue({ count: 0 });
    jobStore.updateMany.mockResolvedValue({ count: 0 });
    jobStore.updateManyAndReturn.mockResolvedValue([]);
    jobStore.findFirst.mockResolvedValue(null);
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
      {
        id: JOB_A,
        description:
          "Requires Java, Spring Boot, Kafka, Scala, Hibernate, Kubernetes, Terraform and Jenkins.",
        market: "AU",
        updatedAt: JOB_UPDATED_AT,
      },
      // Overlapping JD stays for the AI pump.
      {
        id: JOB_B,
        description: "TypeScript, React, Node.js and AWS for a product team.",
        market: "AU",
        updatedAt: JOB_UPDATED_AT,
      },
    ]);
    jobStore.updateMany
      .mockResolvedValueOnce({ count: 2 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 3 })
      .mockResolvedValueOnce({ count: 1 });
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
        market: { in: ["AU", "CN"] },
        status: "NEW",
        fitSource: { in: ["failed", "cancelled"] },
      },
      data: expect.objectContaining({ fitSource: null, fitScoredAt: null }),
    });
  });

  it("prescreens selected Jobs behind JOBJ then JOBF without touching an active Claim", async () => {
    jobStore.findMany.mockResolvedValueOnce([
      {
        id: JOB_A,
        description:
          "Requires Java, Spring Boot, Kafka, Scala, Hibernate, Kubernetes, Terraform and Jenkins.",
        market: "AU",
        updatedAt: JOB_UPDATED_AT,
      },
      // JOB_B is intentionally absent: the query predicate leaves a
      // `claim:<attempt>` row under the durable Claim authority.
    ]);
    jobStore.updateMany.mockResolvedValueOnce({ count: 1 });

    const response = await prescreenPOST(
      post("http://localhost/api/jobs/fit/prescreen", {
        jobIds: [JOB_A, JOB_B],
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      poor: [
        {
          jobId: JOB_A,
          score: expect.any(Number),
          verdict: expect.any(String),
        },
      ],
      needAi: [],
    });
    expect(txMock.executeRaw).toHaveBeenCalledTimes(2);
    expect(jobStore.findMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        market: { in: ["AU", "CN"] },
        status: "NEW",
        fitScoredAt: null,
        OR: [
          { fitSource: null },
          { fitSource: { not: { startsWith: "claim:" } } },
        ],
        id: { in: [JOB_A, JOB_B] },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        description: true,
        market: true,
        updatedAt: true,
      },
    });
    expect(jobStore.updateMany).toHaveBeenCalledTimes(1);
    expect(jobStore.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: JOB_A,
        updatedAt: JOB_UPDATED_AT,
        userId: "user-1",
        market: { in: ["AU", "CN"] },
        status: "NEW",
        fitScoredAt: null,
        OR: [
          { fitSource: null },
          { fitSource: { not: { startsWith: "claim:" } } },
        ],
      }),
      data: expect.objectContaining({
        fitSource: "prescreen",
        fitScoredAt: expect.any(Date),
        fitSnapshotHash: "2026-07-20T00:00:00.000Z",
      }),
    });
  });

  it("returns only selected prescreen writes that still win the eligibility predicate", async () => {
    jobStore.findMany.mockResolvedValueOnce([
      {
        id: JOB_A,
        description:
          "Requires Java, Spring Boot, Kafka, Scala, Hibernate, Kubernetes, Terraform and Jenkins.",
        market: "AU",
        updatedAt: JOB_UPDATED_AT,
      },
    ]);
    jobStore.updateMany.mockResolvedValueOnce({ count: 0 });

    const response = await prescreenPOST(
      post("http://localhost/api/jobs/fit/prescreen", { jobIds: [JOB_A] }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ poor: [], needAi: [] });
  });

  it("keeps released durable Claim members fenced through prescreen and exact reclaim", async () => {
    const claimId = "99999999-9999-4999-8999-999999999999";
    const attemptId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const items = [{ jobId: JOB_A }, { jobId: JOB_B }];
    fitClaimStore.findFirst
      .mockResolvedValueOnce({
        id: claimId,
        status: "ACTIVE",
        executionAttemptId: attemptId,
        items,
      })
      // Commit-time prescreen authority check. The mocked outer Job read
      // deliberately simulates a drifted/null compatibility projection.
      .mockResolvedValueOnce({ items })
      .mockResolvedValueOnce({
        id: claimId,
        executionAttemptId: attemptId,
        executionLeaseExpiresAt: null,
        items: items.map((item, ordinal) => ({ ...item, ordinal })),
      });
    jobStore.findMany
      .mockResolvedValueOnce([
        {
          id: JOB_A,
          description:
            "Requires Java, Spring Boot, Kafka, Scala, Hibernate, Kubernetes, Terraform and Jenkins.",
          market: "AU",
          updatedAt: JOB_UPDATED_AT,
        },
      ])
      .mockResolvedValueOnce([{ id: JOB_A }, { id: JOB_B }]);
    jobStore.count.mockResolvedValueOnce(2).mockResolvedValueOnce(2);

    const released = await releaseBatchPOST(
      post("http://localhost/api/jobs/fit/release-batch", {
        jobIds: [JOB_A, JOB_B],
        claimToken: attemptId,
      }),
    );
    await expect(released.json()).resolves.toEqual({ count: 2 });
    expect(jobStore.updateMany).not.toHaveBeenCalled();

    const prescreened = await prescreenPOST(
      post("http://localhost/api/jobs/fit/prescreen", { jobIds: [JOB_A] }),
    );
    await expect(prescreened.json()).resolves.toEqual({
      poor: [],
      needAi: [],
    });
    expect(jobStore.updateMany).not.toHaveBeenCalled();

    const reclaimed = await nextBatchPOST(
      new Request("http://localhost/api/jobs/fit/next-batch", {
        method: "POST",
      }),
    );
    await expect(reclaimed.json()).resolves.toMatchObject({
      jobIds: [JOB_A, JOB_B],
      claimId,
      claimToken: expect.any(String),
      attemptId: expect.any(String),
    });
    expect(fitClaimStore.update).toHaveBeenNthCalledWith(1, {
      where: { id: claimId },
      data: expect.objectContaining({ executionLeaseExpiresAt: null }),
    });
    expect(fitClaimStore.update).toHaveBeenNthCalledWith(2, {
      where: { id: claimId },
      data: expect.objectContaining({
        executionAttemptId: expect.not.stringMatching(attemptId),
        executionLeaseExpiresAt: expect.any(Date),
        attempt: { increment: 1 },
      }),
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
    expect(txMock.executeRaw).toHaveBeenCalledTimes(2);
    expect(jobStore.updateMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        market: { in: ["AU", "CN"] },
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
      { id: JOB_B, market: "AU" },
    ]);
    jobStore.updateManyAndReturn.mockResolvedValueOnce([
      { id: JOB_A },
      { id: JOB_B },
    ]);
    jobStore.count.mockResolvedValueOnce(7).mockResolvedValueOnce(3);

    const response = await nextBatchPOST(
      new Request("http://localhost/api/jobs/fit/next-batch", {
        method: "POST",
      }),
    );
    const json = await response.json();

    expect(json).toEqual({
      jobIds: [JOB_A, JOB_B],
      remaining: 5,
      pendingTotal: 7,
      leased: 2,
      retryAfterMs: null,
      claimToken: expect.any(String),
      claimId: "99999999-9999-4999-8999-999999999999",
      attemptId: expect.any(String),
    });
    expect(txMock.executeRaw).toHaveBeenCalledTimes(2);
    expect(jobStore.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "user-1",
          market: { in: ["AU", "CN"] },
          status: "NEW",
          fitScoredAt: null,
        }),
        take: 15,
      }),
    );
    expect(jobStore.updateManyAndReturn).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fitSource: expect.stringMatching(/^claim:/),
        }),
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

    const response = await nextBatchPOST(
      new Request("http://localhost/api/jobs/fit/next-batch", {
        method: "POST",
      }),
    );

    expect(await response.json()).toMatchObject({ jobIds: [JOB_A] });
    expect(jobStore.updateManyAndReturn).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: [JOB_A] } }),
      }),
    );
  });

  it("next-batch reports fresh leased work instead of falsely declaring completion", async () => {
    jobStore.findMany.mockResolvedValueOnce([]);
    jobStore.count.mockResolvedValueOnce(2).mockResolvedValueOnce(2);

    const response = await nextBatchPOST(
      new Request("http://localhost/api/jobs/fit/next-batch", {
        method: "POST",
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      jobIds: [],
      remaining: 2,
      pendingTotal: 2,
      leased: 2,
      retryAfterMs: 5_000,
      claimToken: null,
      claimId: null,
      attemptId: null,
    });
    expect(jobStore.count).toHaveBeenNthCalledWith(1, {
      where: {
        userId: "user-1",
        market: { in: ["AU", "CN"] },
        status: "NEW",
        fitScoredAt: null,
      },
    });
    expect(jobStore.count).toHaveBeenNthCalledWith(2, {
      where: {
        userId: "user-1",
        market: { in: ["AU", "CN"] },
        status: "NEW",
        fitScoredAt: null,
        fitSource: { startsWith: "claim:" },
        updatedAt: { gte: expect.any(Date) },
      },
    });
  });

  it("next-batch declares completion only when no pending or leased jobs remain", async () => {
    jobStore.findMany.mockResolvedValueOnce([]);
    jobStore.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);

    const response = await nextBatchPOST(
      new Request("http://localhost/api/jobs/fit/next-batch", {
        method: "POST",
      }),
    );

    expect(await response.json()).toEqual({
      jobIds: [],
      remaining: 0,
      pendingTotal: 0,
      leased: 0,
      retryAfterMs: null,
      claimToken: null,
      claimId: null,
      attemptId: null,
    });
  });

  it("mark-failed dequeues only unscored jobs of this user", async () => {
    jobStore.updateMany.mockResolvedValueOnce({ count: 2 });
    const claimToken = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const response = await markFailedPOST(
      post("http://localhost/api/jobs/fit/mark-failed", {
        jobIds: [JOB_A, JOB_B],
        claimToken,
      }),
    );
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

  it("rejects a late model-failure report for a cancelled durable Claim", async () => {
    const claimToken = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    fitClaimStore.findFirst.mockResolvedValueOnce({
      id: "99999999-9999-4999-8999-999999999999",
      status: "CANCELLED",
      executionAttemptId: claimToken,
      items: [
        { jobId: JOB_A, outcome: "FAILED" },
        { jobId: JOB_B, outcome: "FAILED" },
      ],
    });

    const response = await markFailedPOST(
      post("http://localhost/api/jobs/fit/mark-failed", {
        jobIds: [JOB_A, JOB_B],
        claimToken,
      }),
    );

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("FIT_CLAIM_EXPIRED");
    expect(jobStore.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a late model-failure report after a durable Claim is released", async () => {
    const claimToken = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const claim = {
      id: "99999999-9999-4999-8999-999999999999",
      status: "ACTIVE",
      executionAttemptId: claimToken,
      items: [
        { jobId: JOB_A, outcome: null },
        { jobId: JOB_B, outcome: null },
      ],
    };
    fitClaimStore.findFirst
      .mockResolvedValueOnce({
        ...claim,
        executionLeaseExpiresAt: new Date(Date.now() + 60_000),
      })
      .mockResolvedValueOnce({
        ...claim,
        executionLeaseExpiresAt: null,
      });

    const releaseResponse = await releaseBatchPOST(
      post("http://localhost/api/jobs/fit/release-batch", {
        jobIds: [JOB_A, JOB_B],
        claimToken,
      }),
    );
    const failureResponse = await markFailedPOST(
      post("http://localhost/api/jobs/fit/mark-failed", {
        jobIds: [JOB_A, JOB_B],
        claimToken,
      }),
    );

    expect(releaseResponse.status).toBe(200);
    expect(await releaseResponse.json()).toEqual({ count: 2 });
    expect(failureResponse.status).toBe(409);
    expect((await failureResponse.json()).error.code).toBe("FIT_CLAIM_EXPIRED");
    expect(jobStore.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a late model-failure report after a durable Claim lease expires", async () => {
    const claimToken = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    fitClaimStore.findFirst.mockResolvedValueOnce({
      id: "99999999-9999-4999-8999-999999999999",
      status: "ACTIVE",
      executionAttemptId: claimToken,
      executionLeaseExpiresAt: new Date(Date.now() - 1),
      items: [
        { jobId: JOB_A, outcome: null },
        { jobId: JOB_B, outcome: null },
      ],
    });

    const response = await markFailedPOST(
      post("http://localhost/api/jobs/fit/mark-failed", {
        jobIds: [JOB_A, JOB_B],
        claimToken,
      }),
    );

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("FIT_CLAIM_EXPIRED");
    expect(jobStore.updateMany).not.toHaveBeenCalled();
  });

  it("releases only the caller's legacy projected claim when no durable Claim exists", async () => {
    const claimToken = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    jobStore.updateMany.mockResolvedValueOnce({ count: 2 });

    const response = await releaseBatchPOST(
      post("http://localhost/api/jobs/fit/release-batch", {
        jobIds: [JOB_A, JOB_B],
        claimToken,
      }),
    );

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

  it("adopts one stale legacy claim as an exact durable batch before new work", async () => {
    const legacySource = "claim:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    jobStore.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ fitSource: legacySource });
    jobStore.findMany.mockResolvedValueOnce([
      { id: JOB_A, market: "AU" },
      { id: JOB_B, market: "AU" },
    ]);
    jobStore.updateManyAndReturn.mockResolvedValueOnce([
      { id: JOB_A },
      { id: JOB_B },
    ]);
    jobStore.count.mockResolvedValueOnce(2);

    const response = await nextBatchPOST(
      new Request("http://localhost/api/jobs/fit/next-batch", {
        method: "POST",
      }),
    );

    expect(await response.json()).toMatchObject({
      jobIds: [JOB_A, JOB_B],
      claimId: "99999999-9999-4999-8999-999999999999",
      attemptId: expect.any(String),
    });
    expect(jobStore.findMany).toHaveBeenCalledTimes(1);
    expect(jobStore.findMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        status: "NEW",
        fitScoredAt: null,
        fitSource: legacySource,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 16,
      select: { id: true, market: true },
    });
    expect(jobStore.updateManyAndReturn).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ fitSource: legacySource }),
        data: { fitSource: expect.stringMatching(/^claim:/) },
      }),
    );
  });

  it("waits for a fresh legacy lease instead of starting overlapping durable work", async () => {
    jobStore.findFirst.mockResolvedValueOnce({ id: JOB_A });
    jobStore.count.mockResolvedValueOnce(4).mockResolvedValueOnce(1);

    const response = await nextBatchPOST(
      new Request("http://localhost/api/jobs/fit/next-batch", {
        method: "POST",
      }),
    );

    expect(await response.json()).toEqual({
      jobIds: [],
      remaining: 4,
      pendingTotal: 4,
      leased: 1,
      retryAfterMs: 5_000,
      claimToken: null,
      claimId: null,
      attemptId: null,
    });
    expect(jobStore.findMany).not.toHaveBeenCalled();
    expect(fitClaimStore.create).not.toHaveBeenCalled();
  });

  it("atomically supersedes a Claim whose bound prompt receipt drifts", async () => {
    const claimId = "99999999-9999-4999-8999-999999999999";
    const attemptId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    fitClaimStore.findFirst.mockResolvedValueOnce({
      id: claimId,
      executionAttemptId: attemptId,
      executionLeaseExpiresAt: new Date(Date.now() + 60_000),
      issueKey: "d".repeat(64),
      issueHash: "e".repeat(64),
      promptHash: "f".repeat(64),
      promptMetaHash: "0".repeat(64),
      items: [{ jobId: JOB_A }],
    });

    const mismatch = await bindFitBatchPrompt(
      "user-1",
      [JOB_A],
      {
        requestId: "request-1",
        prompt: {
          input: "input",
          instructions: "instructions",
          sessionId: "s",
        },
        promptMeta: {
          ruleSetId: "rules-1",
          resumeSnapshotUpdatedAt: "2026-07-31T00:00:00.000Z",
          promptTemplateVersion: "2026.07.v2",
          schemaVersion: "2026-07-24",
          skillPackVersion: "b".repeat(64),
          promptHash: "c".repeat(64),
        },
        expectedJsonShape: "[]",
        expectedJsonSchema: { type: "array" },
        promptVersion: "v4-application-proposal",
        issueKey: "d".repeat(64),
        snapshotBinding: {
          resumeProfileId: "77777777-7777-4777-8777-777777777777",
          resumeSnapshotHash: "1".repeat(64),
          jobSnapshotHash: "2".repeat(64),
        },
      },
      { claimId, attemptId },
    ).catch((error) => error);

    expect(mismatch).toMatchObject({ code: "FIT_PROMPT_MISMATCH" });
    expect(jobStore.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: [JOB_A] },
        userId: "user-1",
        status: "NEW",
        fitScoredAt: null,
        fitSource: `claim:${attemptId}`,
      },
      data: { fitSource: null },
    });
    expect(fitClaimItemStore.updateMany).toHaveBeenCalledWith({
      where: { claimId, outcome: null },
      data: expect.objectContaining({
        outcome: "FAILED",
        failureCode: "PROMPT_SUPERSEDED",
      }),
    });
    expect(fitClaimStore.update).toHaveBeenCalledWith({
      where: { id: claimId },
      data: expect.objectContaining({
        status: "SUPERSEDED",
        executionLeaseExpiresAt: null,
        terminalAt: expect.any(Date),
      }),
    });
  });

  it("binds an old Runner's jobIds-only prompt to the active durable Claim", async () => {
    const claimId = "99999999-9999-4999-8999-999999999999";
    const attemptId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    fitClaimStore.findFirst.mockResolvedValueOnce({
      id: claimId,
      executionAttemptId: attemptId,
      executionLeaseExpiresAt: new Date(Date.now() + 60_000),
      issueKey: null,
      items: [{ jobId: JOB_A }],
    });
    const issued = {
      requestId: "request-1",
      prompt: {
        input: "input",
        instructions: "instructions",
        sessionId: "s",
      },
      promptMeta: {
        ruleSetId: "rules-1",
        resumeSnapshotUpdatedAt: "2026-07-31T00:00:00.000Z",
        promptTemplateVersion: "2026.07.v2",
        schemaVersion: "2026-07-24",
        skillPackVersion: "b".repeat(64),
        promptHash: "c".repeat(64),
      },
      expectedJsonShape: "[]",
      expectedJsonSchema: { type: "array" },
      promptVersion: "v4-application-proposal" as const,
      issueKey: "d".repeat(64),
      snapshotBinding: {
        resumeProfileId: "77777777-7777-4777-8777-777777777777",
        resumeSnapshotHash: "1".repeat(64),
        jobSnapshotHash: "2".repeat(64),
      },
    };

    const result = await bindFitBatchPrompt("user-1", [JOB_A], issued);

    expect(result.fitClaim).toEqual({
      id: claimId,
      attemptId,
      issueKey: issued.issueKey,
    });
    expect(fitClaimStore.update).toHaveBeenCalledWith({
      where: { id: claimId },
      data: expect.objectContaining({
        issueKey: issued.issueKey,
        promptMeta: issued.promptMeta,
      }),
    });
  });

  it("renews only the current durable Fit attempt", async () => {
    fitClaimStore.updateMany.mockResolvedValueOnce({ count: 1 });

    const heartbeat = await heartbeatFitBatchClaim({
      userId: "user-1",
      claimId: "99999999-9999-4999-8999-999999999999",
      attemptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });

    expect(heartbeat).toMatchObject({
      claimId: "99999999-9999-4999-8999-999999999999",
      attemptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      leaseExpiresAt: expect.any(Date),
      heartbeatAfterMs: 60_000,
    });
    expect(txMock.executeRaw).toHaveBeenCalledTimes(1);
    expect(jobStore.updateMany).not.toHaveBeenCalled();
  });

  it("exposes heartbeat as a no-store request-correlated Agent route", async () => {
    fitClaimStore.updateMany.mockResolvedValueOnce({ count: 1 });

    const response = await heartbeatPOST(
      post("http://localhost/api/jobs/fit/heartbeat", {
        claimId: "99999999-9999-4999-8999-999999999999",
        attemptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(response.headers.get("X-Request-Id")).toMatch(/^[0-9a-f-]{36}$/i);
    expect(response.headers.get("X-RateLimit-Limit")).toBe("120");
  });

  it("bulk-ignore previews, sweeps only scored low-fit NEW jobs, and restores on undo", async () => {
    jobStore.count.mockResolvedValueOnce(3);
    const preview = await bulkIgnorePOST(
      post("http://localhost/api/jobs/bulk-ignore", {
        maxScore: 44,
        preview: true,
      }),
    );
    expect(await preview.json()).toEqual({ count: 3 });

    applicationEventMock.bulkAppendStatusEvents.mockResolvedValueOnce({
      count: 2,
    });
    const sweep = await bulkIgnorePOST(
      post("http://localhost/api/jobs/bulk-ignore", { maxScore: 44 }),
    );
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
              market: { in: ["AU"] },
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
    const restore = await bulkIgnorePOST(
      post("http://localhost/api/jobs/bulk-ignore", {
        restoreIgnoredAt: sweepBody.ignoredAt,
        maxScore: 44,
      }),
    );
    expect(await restore.json()).toEqual({ restored: 2 });
    expect(
      applicationEventMock.bulkAppendStatusEvents,
    ).toHaveBeenLastCalledWith(
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
    const response = await bulkIgnorePOST(
      post("http://localhost/api/jobs/bulk-ignore", { maxScore: 80 }),
    );
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
    expect(applicationEventMock.bulkAppendStatusEvents).not.toHaveBeenCalled();
  });
});
