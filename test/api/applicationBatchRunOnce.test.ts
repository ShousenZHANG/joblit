import { beforeEach, describe, expect, it, vi } from "vitest";

const runner = vi.hoisted(() => ({
  // Hoisted out of the claim loop: it scans the whole batch, so it is per-run
  // work, not per-claim work.
  reclaimStaleBatchTasks: vi.fn(),
  claimNextBatchTask: vi.fn(),
  completeBatchTask: vi.fn(),
  releaseBatchTask: vi.fn(),
  getBatchProgress: vi.fn(),
  getBatchLeaseRetryHint: vi.fn(),
  BatchRunnerError: class BatchRunnerError extends Error {
    code: "NOT_FOUND" | "INVALID_STATE";

    constructor(code: "NOT_FOUND" | "INVALID_STATE", message: string) {
      super(message);
      this.code = code;
    }
  },
}));

const promptRules = vi.hoisted(() => ({
  getActivePromptSkillRulesForUser: vi.fn(),
}));

const resumeProfile = vi.hoisted(() => ({
  getResumeProfile: vi.fn(),
}));

const applicationBatchStore = vi.hoisted(() => ({
  findFirst: vi.fn(),
}));

const jobStore = vi.hoisted(() => ({
  findFirst: vi.fn(),
}));

vi.mock("@/lib/server/applicationBatches/runner", () => runner);
vi.mock("@/lib/server/promptRuleTemplates", () => promptRules);
vi.mock("@/lib/server/resumeProfile", () => resumeProfile);
vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    applicationBatch: applicationBatchStore,
    job: jobStore,
  },
}));

vi.mock("@/auth", () => ({
  authOptions: {},
}));

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

import { getServerSession } from "next-auth/next";
import { POST } from "@/app/api/application-batches/[id]/run-once/route";

const BATCH_ID = "550e8400-e29b-41d4-a716-446655440000";
const TASK_ID = "660e8400-e29b-41d4-a716-446655440000";
const JOB_ID = "770e8400-e29b-41d4-a716-446655440000";
const COMPLETED_ATTEMPT_ID = "880e8400-e29b-41d4-a716-446655440000";
const NEXT_ATTEMPT_ID = "990e8400-e29b-41d4-a716-446655440000";

describe("application batch run-once api", () => {
  beforeEach(() => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockReset();
    applicationBatchStore.findFirst.mockReset();
    jobStore.findFirst.mockReset();
    runner.reclaimStaleBatchTasks.mockReset();
    runner.claimNextBatchTask.mockReset();
    runner.completeBatchTask.mockReset();
    runner.releaseBatchTask.mockReset();
    runner.getBatchProgress.mockReset();
    runner.getBatchLeaseRetryHint.mockReset();
    promptRules.getActivePromptSkillRulesForUser.mockReset();
    resumeProfile.getResumeProfile.mockReset();
  });

  it("applies fenced failure completion and claims the next attempt", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });

    applicationBatchStore.findFirst.mockResolvedValueOnce({
      id: BATCH_ID,
      status: "RUNNING",
      scope: "NEW",
      totalCount: 3,
      error: null,
    });
    resumeProfile.getResumeProfile.mockResolvedValueOnce({
      id: "profile-1",
      updatedAt: new Date("2026-02-22T10:00:00.000Z"),
      summary: "Summary",
      experiences: [{ title: "Software Engineer", bullets: ["one"] }],
      skills: [{ category: "Frontend", items: ["React"] }],
    });
    promptRules.getActivePromptSkillRulesForUser.mockResolvedValueOnce({
      id: "rules-1",
      locale: "en-AU",
      cvRules: ["cv-1"],
      coverRules: ["cover-1"],
      hardConstraints: ["hard-1"],
    });
    runner.completeBatchTask.mockResolvedValueOnce({
      taskStatus: "FAILED",
      batchStatus: "RUNNING",
      progress: {
        pending: 2,
        running: 0,
        succeeded: 0,
        failed: 1,
        skipped: 0,
      },
    });
    runner.claimNextBatchTask
      .mockResolvedValueOnce({
        kind: "claimed",
        task: {
          id: TASK_ID,
          attemptId: NEXT_ATTEMPT_ID,
          jobId: JOB_ID,
          title: "Software Engineer",
          company: "Acme",
          jobUrl: "https://example.com/jobs/1",
        },
      })
      .mockResolvedValueOnce({
        kind: "done",
        batchStatus: "RUNNING",
        progress: {
          pending: 1,
          running: 0,
          succeeded: 2,
          failed: 0,
          skipped: 0,
        },
      });
    jobStore.findFirst.mockResolvedValueOnce({
      id: JOB_ID,
      title: "Software Engineer",
      company: "Acme",
      jobUrl: "https://example.com/jobs/1",
      status: "NEW",
      description: "Job description",
      updatedAt: new Date("2026-02-22T09:59:00.000Z"),
    });
    runner.getBatchProgress.mockResolvedValueOnce({
      pending: 1,
      running: 0,
      succeeded: 2,
      failed: 0,
      skipped: 0,
    });

    const res = await POST(
      new Request(`http://localhost/api/application-batches/${BATCH_ID}/run-once`, {
        method: "POST",
        body: JSON.stringify({
          maxSteps: 2,
          completedTasks: [
            {
              taskId: TASK_ID,
              attemptId: COMPLETED_ATTEMPT_ID,
              status: "FAILED",
              error: "compile failed",
            },
          ],
        }),
      }),
      { params: Promise.resolve({ id: BATCH_ID }) },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.batch.id).toBe(BATCH_ID);
    expect(json.tasks).toHaveLength(1);
    expect(json.tasks[0].taskId).toBe(TASK_ID);
    expect(json.tasks[0].attemptId).toBe(NEXT_ATTEMPT_ID);
    expect(json.execution.completedCount).toBe(1);
    expect(runner.completeBatchTask).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        batchId: BATCH_ID,
        taskId: TASK_ID,
        attemptId: COMPLETED_ATTEMPT_ID,
        status: "FAILED",
        error: "compile failed",
      }),
    );
    expect(runner.claimNextBatchTask).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ supportedProtocolVersions: [1] }),
    );
  });

  it("forwards an explicit v2 capability without changing the server-first default", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    applicationBatchStore.findFirst.mockResolvedValueOnce({
      id: BATCH_ID,
      status: "RUNNING",
      scope: "NEW",
      totalCount: 1,
      error: null,
    });
    resumeProfile.getResumeProfile.mockResolvedValueOnce({
      id: "profile-1",
      updatedAt: new Date("2026-02-22T10:00:00.000Z"),
    });
    promptRules.getActivePromptSkillRulesForUser.mockResolvedValueOnce({
      id: "rules-1",
      locale: "en-AU",
      cvRules: [],
      coverRules: [],
      hardConstraints: [],
    });
    runner.claimNextBatchTask.mockResolvedValueOnce({
      kind: "done",
      batchStatus: "RUNNING",
      progress: {
        pending: 0,
        running: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0,
      },
    });
    runner.getBatchProgress.mockResolvedValueOnce({
      pending: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
    });

    const res = await POST(
      new Request(`http://localhost/api/application-batches/${BATCH_ID}/run-once`, {
        method: "POST",
        body: JSON.stringify({ supportedProtocolVersions: [2, 1] }),
      }),
      { params: Promise.resolve({ id: BATCH_ID }) },
    );

    expect(res.status).toBe(200);
    expect(runner.claimNextBatchTask).toHaveBeenCalledWith(
      expect.objectContaining({ supportedProtocolVersions: [2, 1] }),
    );
  });

  it("releases a v2 publication lease without claiming work in the same request", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    applicationBatchStore.findFirst.mockResolvedValueOnce({
      id: BATCH_ID,
      status: "RUNNING",
      scope: "NEW",
      totalCount: 1,
      error: null,
    });
    resumeProfile.getResumeProfile.mockResolvedValueOnce({
      id: "profile-1",
      updatedAt: new Date("2026-02-22T10:00:00.000Z"),
    });
    promptRules.getActivePromptSkillRulesForUser.mockResolvedValueOnce({
      id: "rules-1",
      locale: "en-AU",
      cvRules: [],
      coverRules: [],
      hardConstraints: [],
    });
    runner.releaseBatchTask.mockResolvedValueOnce({ released: true, replayed: false });
    runner.getBatchProgress.mockResolvedValueOnce({
      pending: 1,
      running: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
    });

    const res = await POST(
      new Request(`http://localhost/api/application-batches/${BATCH_ID}/run-once`, {
        method: "POST",
        body: JSON.stringify({
          maxSteps: 0,
          supportedProtocolVersions: [2, 1],
          releasedTasks: [
            {
              taskId: TASK_ID,
              attemptId: COMPLETED_ATTEMPT_ID,
              reason: "PUBLICATION_SETTLEMENT_UNKNOWN",
            },
          ],
        }),
      }),
      { params: Promise.resolve({ id: BATCH_ID }) },
    );

    expect(res.status).toBe(200);
    expect(runner.releaseBatchTask).toHaveBeenCalledWith({
      userId: "user-1",
      batchId: BATCH_ID,
      taskId: TASK_ID,
      attemptId: COMPLETED_ATTEMPT_ID,
      reason: "PUBLICATION_SETTLEMENT_UNKNOWN",
    });
    expect(runner.claimNextBatchTask).not.toHaveBeenCalled();
  });

  it("rejects independent success completion before touching the batch", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });

    const res = await POST(
      new Request(`http://localhost/api/application-batches/${BATCH_ID}/run-once`, {
        method: "POST",
        body: JSON.stringify({
          completedTasks: [
            {
              taskId: TASK_ID,
              attemptId: COMPLETED_ATTEMPT_ID,
              status: "SUCCEEDED",
            },
          ],
        }),
      }),
      { params: Promise.resolve({ id: BATCH_ID }) },
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error.code).toBe("INVALID_BODY");
    expect(applicationBatchStore.findFirst).not.toHaveBeenCalled();
    expect(runner.completeBatchTask).not.toHaveBeenCalled();
  });

  it("returns a bounded retry hint while another fresh task lease is running", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    applicationBatchStore.findFirst.mockResolvedValueOnce({
      id: BATCH_ID,
      status: "RUNNING",
      scope: "NEW",
      totalCount: 1,
      error: null,
    });
    resumeProfile.getResumeProfile.mockResolvedValueOnce({
      id: "profile-1",
      updatedAt: new Date("2026-02-22T10:00:00.000Z"),
    });
    promptRules.getActivePromptSkillRulesForUser.mockResolvedValueOnce({
      id: "rules-1",
      locale: "en-AU",
      cvRules: [],
      coverRules: [],
      hardConstraints: [],
    });
    runner.claimNextBatchTask.mockResolvedValueOnce({
      kind: "done",
      batchStatus: "RUNNING",
      progress: {
        pending: 0,
        running: 1,
        succeeded: 0,
        failed: 0,
        skipped: 0,
      },
    });
    runner.getBatchProgress.mockResolvedValueOnce({
      pending: 0,
      running: 1,
      succeeded: 0,
      failed: 0,
      skipped: 0,
    });
    runner.getBatchLeaseRetryHint.mockResolvedValueOnce({
      retryAfterMs: 30_000,
      earliestLeaseExpiresAt: "2026-02-22T10:20:00.000Z",
    });

    const res = await POST(
      new Request(`http://localhost/api/application-batches/${BATCH_ID}/run-once`, {
        method: "POST",
        body: JSON.stringify({ maxSteps: 1 }),
      }),
      { params: Promise.resolve({ id: BATCH_ID }) },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.batch.status).toBe("RUNNING");
    expect(json.tasks).toEqual([]);
    expect(json.execution).toMatchObject({
      stopReason: "LEASE_ACTIVE",
      retryAfterMs: 30_000,
      earliestLeaseExpiresAt: "2026-02-22T10:20:00.000Z",
    });
    expect(runner.getBatchLeaseRetryHint).toHaveBeenCalledWith({
      userId: "user-1",
      batchId: BATCH_ID,
    });
  });

  it.each([
    [{ maxSteps: "1" }, "string maxSteps"],
    [{ maxSteps: 1, extra: true }, "unknown body field"],
    [
      {
        completedTasks: [
          {
            taskId: TASK_ID,
            attemptId: COMPLETED_ATTEMPT_ID,
            status: "FAILED",
            unexpected: true,
          },
        ],
      },
      "unknown completion field",
    ],
  ])("rejects %s before touching the batch", async (body, _label) => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });

    const res = await POST(
      new Request(`http://localhost/api/application-batches/${BATCH_ID}/run-once`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id: BATCH_ID }) },
    );

    expect(res.status).toBe(400);
    expect(applicationBatchStore.findFirst).not.toHaveBeenCalled();
  });
});
