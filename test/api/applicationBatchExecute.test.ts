import { beforeEach, describe, expect, it, vi } from "vitest";

const runner = vi.hoisted(() => ({
  claimNextBatchTask: vi.fn(),
  completeBatchTask: vi.fn(),
  getBatchProgress: vi.fn(),
}));

const artifacts = vi.hoisted(() => ({
  generateApplicationArtifactsForJob: vi.fn(),
}));

const applicationBatchStore = vi.hoisted(() => ({
  findFirst: vi.fn(),
}));

vi.mock("@/lib/server/applicationBatches/runner", () => runner);
vi.mock("@/lib/server/applications/generateApplicationArtifacts", () => artifacts);
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

const BATCH_ID = "550e8400-e29b-41d4-a716-446655440000";
const TASK_ID = "660e8400-e29b-41d4-a716-446655440000";
const JOB_ID = "770e8400-e29b-41d4-a716-446655440000";

describe("application batch execute api", () => {
  beforeEach(() => {
    process.env.ENABLE_BATCH_EXECUTE_AUTOGEN = "1";
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockReset();
    applicationBatchStore.findFirst.mockReset();
    runner.claimNextBatchTask.mockReset();
    runner.completeBatchTask.mockReset();
    runner.getBatchProgress.mockReset();
    artifacts.generateApplicationArtifactsForJob.mockReset();
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
    expect(artifacts.generateApplicationArtifactsForJob).not.toHaveBeenCalled();
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
    artifacts.generateApplicationArtifactsForJob.mockResolvedValueOnce({
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
    expect(artifacts.generateApplicationArtifactsForJob).toHaveBeenCalledWith({
      userId: "user-1",
      jobId: JOB_ID,
    });
    expect(runner.completeBatchTask).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        batchId: BATCH_ID,
        taskId: TASK_ID,
        status: "SUCCEEDED",
      }),
    );
  });
});
