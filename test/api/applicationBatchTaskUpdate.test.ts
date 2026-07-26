import { beforeEach, describe, expect, it, vi } from "vitest";

const runner = vi.hoisted(() => ({
  completeBatchTask: vi.fn(),
  BatchRunnerError: class BatchRunnerError extends Error {
    code: "NOT_FOUND" | "INVALID_STATE";

    constructor(code: "NOT_FOUND" | "INVALID_STATE", message: string) {
      super(message);
      this.code = code;
    }
  },
}));

vi.mock("@/lib/server/applicationBatches/runner", () => runner);

vi.mock("@/auth", () => ({
  authOptions: {},
}));

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

import { getServerSession } from "next-auth/next";
import { PATCH } from "@/app/api/application-batches/[id]/tasks/[taskId]/route";

const BATCH_ID = "550e8400-e29b-41d4-a716-446655440000";
const TASK_ID = "660e8400-e29b-41d4-a716-446655440000";
const ATTEMPT_ID = "880e8400-e29b-41d4-a716-446655440000";

describe("application batch task update api", () => {
  beforeEach(() => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockReset();
    runner.completeBatchTask.mockReset();
  });

  it("marks the current execution attempt as failed", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    runner.completeBatchTask.mockResolvedValueOnce({
      taskStatus: "FAILED",
      batchStatus: "RUNNING",
      progress: {
        pending: 2,
        running: 0,
        succeeded: 0,
        failed: 3,
        skipped: 0,
      },
    });

    const res = await PATCH(
      new Request(`http://localhost/api/application-batches/${BATCH_ID}/tasks/${TASK_ID}`, {
        method: "PATCH",
        body: JSON.stringify({
          attemptId: ATTEMPT_ID,
          status: "FAILED",
          error: "model output invalid",
        }),
      }),
      { params: Promise.resolve({ id: BATCH_ID, taskId: TASK_ID }) },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.batchStatus).toBe("RUNNING");
    expect(json.progress.failed).toBe(3);
    expect(runner.completeBatchTask).toHaveBeenCalledWith({
      userId: "user-1",
      batchId: BATCH_ID,
      taskId: TASK_ID,
      attemptId: ATTEMPT_ID,
      status: "FAILED",
      error: "model output invalid",
    });
  });

  it("rejects a completion without an execution attempt", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });

    const res = await PATCH(
      new Request(`http://localhost/api/application-batches/${BATCH_ID}/tasks/${TASK_ID}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "FAILED" }),
      }),
      { params: Promise.resolve({ id: BATCH_ID, taskId: TASK_ID }) },
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error.code).toBe("INVALID_BODY");
    expect(runner.completeBatchTask).not.toHaveBeenCalled();
  });

  it("rejects independent success completion", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });

    const res = await PATCH(
      new Request(`http://localhost/api/application-batches/${BATCH_ID}/tasks/${TASK_ID}`, {
        method: "PATCH",
        body: JSON.stringify({
          attemptId: ATTEMPT_ID,
          status: "SUCCEEDED",
        }),
      }),
      { params: Promise.resolve({ id: BATCH_ID, taskId: TASK_ID }) },
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error.code).toBe("INVALID_BODY");
    expect(runner.completeBatchTask).not.toHaveBeenCalled();
  });
});
