import { beforeEach, describe, expect, it, vi } from "vitest";

const sessionMock = vi.hoisted(() => ({ require: vi.fn() }));
const jobStore = vi.hoisted(() => ({
  count: vi.fn(),
  findMany: vi.fn(),
  updateMany: vi.fn(),
}));
const txMock = vi.hoisted(() => ({ transaction: vi.fn() }));
const profileMock = vi.hoisted(() => ({ get: vi.fn() }));

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

vi.mock("@/lib/server/ai/resumePromptSnapshot", () => ({
  buildResumePromptSnapshot: (profile: unknown) => profile,
}));

import { POST as runPOST } from "@/app/api/jobs/fit/run/route";
import { POST as nextBatchPOST } from "@/app/api/jobs/fit/next-batch/route";
import { POST as markFailedPOST } from "@/app/api/jobs/fit/mark-failed/route";
import { POST as bulkIgnorePOST } from "@/app/api/jobs/bulk-ignore/route";

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
    txMock.transaction.mockResolvedValue([]);
    jobStore.updateMany.mockResolvedValue({ count: 0 });
    profileMock.get.mockResolvedValue({
      skills: "TypeScript React Node.js PostgreSQL AWS",
      updatedAt: new Date(),
    });
  });

  it("run prescreens obvious mismatches across the whole database and reports stats", async () => {
    jobStore.findMany.mockResolvedValueOnce([
      // Gazetteer-heavy JD with zero overlap against the resume text.
      { id: JOB_A, description: "Requires Java, Spring Boot, Kafka, Scala, Hibernate, Kubernetes, Terraform and Jenkins.", market: "AU" },
      // Overlapping JD stays for the AI pump.
      { id: JOB_B, description: "TypeScript, React, Node.js and AWS for a product team.", market: "AU" },
    ]);
    txMock.transaction.mockImplementation(async (ops: unknown[]) => ops);
    // Stats after prescreen: 10 NEW total, 1 still pending.
    jobStore.count.mockResolvedValueOnce(10).mockResolvedValueOnce(1);

    const response = await runPOST();
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toMatchObject({ total: 10, pending: 1, scored: 9, prescreened: 1 });
  });

  it("next-batch serves unscored ids from the database, not from the page", async () => {
    jobStore.findMany.mockResolvedValueOnce([{ id: JOB_A }, { id: JOB_B }]);
    jobStore.count.mockResolvedValueOnce(7);

    const response = await nextBatchPOST();
    const json = await response.json();

    expect(json).toEqual({ jobIds: [JOB_A, JOB_B], remaining: 5 });
    expect(jobStore.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1", status: "NEW", fitScoredAt: null },
        take: 15,
      }),
    );
  });

  it("mark-failed dequeues only unscored jobs of this user", async () => {
    jobStore.updateMany.mockResolvedValueOnce({ count: 2 });
    const response = await markFailedPOST(post("http://localhost/api/jobs/fit/mark-failed", { jobIds: [JOB_A, JOB_B] }));
    expect(await response.json()).toEqual({ count: 2 });
    expect(jobStore.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: [JOB_A, JOB_B] }, userId: "user-1", status: "NEW", fitScoredAt: null },
        data: expect.objectContaining({ fitSource: "failed" }),
      }),
    );
  });

  it("bulk-ignore previews, sweeps only scored low-fit NEW jobs, and restores on undo", async () => {
    jobStore.count.mockResolvedValueOnce(3);
    const preview = await bulkIgnorePOST(post("http://localhost/api/jobs/bulk-ignore", { maxScore: 44, preview: true }));
    expect(await preview.json()).toEqual({ count: 3 });

    jobStore.findMany.mockResolvedValueOnce([{ id: JOB_A }, { id: JOB_B }]);
    jobStore.updateMany.mockResolvedValueOnce({ count: 2 });
    const sweep = await bulkIgnorePOST(post("http://localhost/api/jobs/bulk-ignore", { maxScore: 44 }));
    expect(await sweep.json()).toEqual({ count: 2, jobIds: [JOB_A, JOB_B] });
    expect(jobStore.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "NEW",
          fitScore: { not: null, lte: 44 },
        }),
      }),
    );

    jobStore.updateMany.mockResolvedValueOnce({ count: 2 });
    const restore = await bulkIgnorePOST(post("http://localhost/api/jobs/bulk-ignore", { restoreJobIds: [JOB_A, JOB_B] }));
    expect(await restore.json()).toEqual({ restored: 2 });
  });

  it("rejects a bulk-ignore threshold above the WEAK/POOR boundary", async () => {
    const response = await bulkIgnorePOST(post("http://localhost/api/jobs/bulk-ignore", { maxScore: 80 }));
    expect(response.status).toBe(400);
  });
});
