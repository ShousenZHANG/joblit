import { beforeEach, describe, expect, it, vi } from "vitest";

const runner = vi.hoisted(() => ({
  claimNextBatchTask: vi.fn(),
}));

vi.mock("@/lib/server/applicationBatches/runner", () => runner);

vi.mock("@/auth", () => ({
  authOptions: {},
}));

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

import { getServerSession } from "next-auth/next";
import { POST } from "@/app/api/application-batches/[id]/claim/route";

const BATCH_ID = "550e8400-e29b-41d4-a716-446655440000";
const ATTEMPT_ID = "880e8400-e29b-41d4-a716-446655440000";

describe("application batch claim api", () => {
  beforeEach(() => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockReset();
    runner.claimNextBatchTask.mockReset();
  });

  it("returns claimed task payload when work is available", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    runner.claimNextBatchTask.mockResolvedValueOnce({
      kind: "claimed",
      task: {
        id: "task-1",
        attemptId: ATTEMPT_ID,
        jobId: "job-1",
        title: "Software Engineer",
        company: "Acme",
        jobUrl: "https://example.com/job/1",
      },
    });

    const res = await POST(
      new Request(`http://localhost/api/application-batches/${BATCH_ID}/claim`, { method: "POST" }),
      { params: Promise.resolve({ id: BATCH_ID }) },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.kind).toBe("claimed");
    expect(json.task.id).toBe("task-1");
    expect(json.task.attemptId).toBe(ATTEMPT_ID);
  });

  it("returns done when no pending tasks remain", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user-1" },
    });
    runner.claimNextBatchTask.mockResolvedValueOnce({
      kind: "done",
      batchStatus: "SUCCEEDED",
    });

    const res = await POST(
      new Request(`http://localhost/api/application-batches/${BATCH_ID}/claim`, { method: "POST" }),
      { params: Promise.resolve({ id: BATCH_ID }) },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.kind).toBe("done");
    expect(json.batchStatus).toBe("SUCCEEDED");
  });
});
