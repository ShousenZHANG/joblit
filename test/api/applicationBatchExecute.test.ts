import { beforeEach, describe, expect, it, vi } from "vitest";

const runner = vi.hoisted(() => ({
  claimNextBatchTask: vi.fn(),
  completeBatchTask: vi.fn(),
  getBatchProgress: vi.fn(),
}));

const tailoringTask = vi.hoisted(() => ({
  executeServerBatchTailoringTask: vi.fn(),
}));

const applicationBatchStore = vi.hoisted(() => ({
  findFirst: vi.fn(),
}));

vi.mock("@/lib/server/applicationBatches/runner", () => runner);
vi.mock(
  "@/lib/server/applications/executeServerBatchTailoringTask",
  () => tailoringTask,
);
vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    applicationBatch: applicationBatchStore,
  },
}));

vi.mock("@/auth", () => ({
  authOptions: {},
}));

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

import { getServerSession } from "next-auth/next";
import { POST } from "@/app/api/application-batches/[id]/execute/route";
import { AppError } from "@/lib/server/api/appError";

const BATCH_ID = "550e8400-e29b-41d4-a716-446655440000";
const TASK_ID = "660e8400-e29b-41d4-a716-446655440000";
const JOB_ID = "770e8400-e29b-41d4-a716-446655440000";
const ATTEMPT_ID = "880e8400-e29b-41d4-a716-446655440000";

describe("application batch execute api", () => {
  beforeEach(() => {
    process.env.ENABLE_BATCH_EXECUTE_AUTOGEN = "1";
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockReset();
    applicationBatchStore.findFirst.mockReset();
    runner.claimNextBatchTask.mockReset();
    runner.completeBatchTask.mockReset();
    runner.getBatchProgress.mockReset();
    tailoringTask.executeServerBatchTailoringTask.mockReset();
  });

  it("returns EXECUTE_DISABLED when server-side auto execute is disabled", async () => {
    process.env.ENABLE_BATCH_EXECUTE_AUTOGEN = "0";
    // The session is resolved before the feature flag is read, so an
    // unauthenticated caller cannot probe whether auto execute is enabled.
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });

    const res = await POST(
      new Request(`http://localhost/api/application-batches/${BATCH_ID}/execute`, {
        method: "POST",
        body: JSON.stringify({ maxSteps: 5 }),
      }),
      { params: Promise.resolve({ id: BATCH_ID }) },
    );
    const json = await res.json();

    expect(res.status).toBe(410);
    expect(json.error.code).toBe("EXECUTE_DISABLED");
    expect(runner.claimNextBatchTask).not.toHaveBeenCalled();
    expect(tailoringTask.executeServerBatchTailoringTask).not.toHaveBeenCalled();
  });

  it("claims tasks, generates artifacts, and completes them", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    applicationBatchStore.findFirst.mockResolvedValueOnce({
      id: BATCH_ID,
      scope: "NEW",
      status: "RUNNING",
      totalCount: 2,
      error: null,
    });
    runner.claimNextBatchTask
      .mockResolvedValueOnce({
        kind: "claimed",
        task: {
          id: TASK_ID,
          attemptId: ATTEMPT_ID,
          issueKey: "990e8400-e29b-51d4-a716-446655440000",
          protocolVersion: 1,
          acceptedTargets: ["RESUME"],
          remainingTargets: ["COVER"],
          jobId: JOB_ID,
          title: "Software Engineer",
          company: "Acme",
          jobUrl: "https://example.com/jobs/1",
        },
      })
      .mockResolvedValueOnce({
        kind: "done",
        batchStatus: "SUCCEEDED",
        progress: {
          pending: 0,
          running: 0,
          succeeded: 2,
          failed: 0,
          skipped: 0,
        },
      });
    tailoringTask.executeServerBatchTailoringTask.mockResolvedValueOnce({
      applicationId: "app-1",
      jobId: JOB_ID,
      resumePdfUrl: "https://blob.example/r1.pdf",
      coverPdfUrl: "https://blob.example/c1.pdf",
    });
    runner.completeBatchTask.mockResolvedValueOnce({
      taskStatus: "SUCCEEDED",
      batchStatus: "RUNNING",
      progress: {
        pending: 1,
        running: 0,
        succeeded: 1,
        failed: 0,
        skipped: 0,
      },
    });
    runner.getBatchProgress.mockResolvedValueOnce({
      pending: 0,
      running: 0,
      succeeded: 2,
      failed: 0,
      skipped: 0,
    });

    const res = await POST(
      new Request(`http://localhost/api/application-batches/${BATCH_ID}/execute`, {
        method: "POST",
        body: JSON.stringify({ maxSteps: 5 }),
      }),
      { params: Promise.resolve({ id: BATCH_ID }) },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.execution.processedCount).toBe(1);
    expect(json.tasks).toHaveLength(1);
    expect(json.tasks[0]).toMatchObject({
      taskId: TASK_ID,
      jobId: JOB_ID,
      status: "SUCCEEDED",
    });
    expect(tailoringTask.executeServerBatchTailoringTask).toHaveBeenCalledWith({
      userId: "user-1",
      jobId: JOB_ID,
      batchId: BATCH_ID,
      taskId: TASK_ID,
      executionAttemptId: ATTEMPT_ID,
      issueKey: "990e8400-e29b-51d4-a716-446655440000",
    });
    expect(runner.completeBatchTask).not.toHaveBeenCalled();
  });

  it("redacts unexpected generator failures from the task record and response", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    applicationBatchStore.findFirst.mockResolvedValueOnce({
      id: BATCH_ID,
      scope: "NEW",
      status: "RUNNING",
      totalCount: 1,
      error: null,
    });
    runner.claimNextBatchTask.mockResolvedValueOnce({
      kind: "claimed",
      task: {
        id: TASK_ID,
        attemptId: ATTEMPT_ID,
        issueKey: "990e8400-e29b-51d4-a716-446655440000",
        protocolVersion: 1,
        acceptedTargets: [],
        remainingTargets: ["RESUME", "COVER"],
        jobId: JOB_ID,
        title: "Software Engineer",
        company: "Acme",
        jobUrl: "https://example.com/jobs/1",
      },
    });
    tailoringTask.executeServerBatchTailoringTask.mockRejectedValueOnce(
      new Error("Provider failed at https://renderer.internal/render?token=super-secret"),
    );
    runner.completeBatchTask.mockResolvedValueOnce({
      taskStatus: "FAILED",
      batchStatus: "FAILED",
      progress: {
        pending: 0,
        running: 0,
        succeeded: 0,
        failed: 1,
        skipped: 0,
      },
    });
    runner.getBatchProgress.mockResolvedValueOnce({
      pending: 0,
      running: 0,
      succeeded: 0,
      failed: 1,
      skipped: 0,
    });

    const res = await POST(
      new Request(`http://localhost/api/application-batches/${BATCH_ID}/execute`, {
        method: "POST",
        body: JSON.stringify({ maxSteps: 1 }),
      }),
      { params: Promise.resolve({ id: BATCH_ID }) },
    );
    const json = await res.json();
    const serialized = JSON.stringify(json);

    expect(res.status).toBe(200);
    expect(json.tasks[0].error).toBe("TASK_FAILED");
    expect(runner.completeBatchTask).toHaveBeenCalledWith(
      expect.objectContaining({ error: "TASK_FAILED" }),
    );
    expect(serialized).not.toContain("renderer.internal");
    expect(serialized).not.toContain("super-secret");
  });

  it("preserves an AppError public message without exposing its private details", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    applicationBatchStore.findFirst.mockResolvedValueOnce({
      id: BATCH_ID,
      scope: "NEW",
      status: "RUNNING",
      totalCount: 1,
      error: null,
    });
    runner.claimNextBatchTask.mockResolvedValueOnce({
      kind: "claimed",
      task: {
        id: TASK_ID,
        attemptId: ATTEMPT_ID,
        issueKey: "990e8400-e29b-51d4-a716-446655440000",
        protocolVersion: 1,
        acceptedTargets: [],
        remainingTargets: ["RESUME", "COVER"],
        jobId: JOB_ID,
        title: "Software Engineer",
        company: "Acme",
        jobUrl: "https://example.com/jobs/1",
      },
    });
    tailoringTask.executeServerBatchTailoringTask.mockRejectedValueOnce(
      new AppError({
        code: "APPLICATION_CONTENT_CHANGED",
        status: 409,
        publicMessage: "Application content changed. Retry the task.",
        privateDetails: {
          providerUrl: "https://renderer.internal/render",
          token: "super-secret",
        },
      }),
    );
    runner.completeBatchTask.mockResolvedValueOnce({
      taskStatus: "FAILED",
      batchStatus: "FAILED",
      progress: {
        pending: 0,
        running: 0,
        succeeded: 0,
        failed: 1,
        skipped: 0,
      },
    });
    runner.getBatchProgress.mockResolvedValueOnce({
      pending: 0,
      running: 0,
      succeeded: 0,
      failed: 1,
      skipped: 0,
    });

    const res = await POST(
      new Request(`http://localhost/api/application-batches/${BATCH_ID}/execute`, {
        method: "POST",
        body: JSON.stringify({ maxSteps: 1 }),
      }),
      { params: Promise.resolve({ id: BATCH_ID }) },
    );
    const json = await res.json();
    const serialized = JSON.stringify(json);

    expect(res.status).toBe(200);
    expect(json.tasks[0].error).toBe("Application content changed. Retry the task.");
    expect(runner.completeBatchTask).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "Application content changed. Retry the task.",
      }),
    );
    expect(serialized).not.toContain("renderer.internal");
    expect(serialized).not.toContain("super-secret");
  });
});
