import { beforeEach, describe, expect, it, vi } from "vitest";

const sessionMock = vi.hoisted(() => ({ require: vi.fn() }));
const jobStore = vi.hoisted(() => ({ updateMany: vi.fn() }));

vi.mock("@/lib/server/auth/requireSession", () => {
  class UnauthorizedError extends Error {}
  return {
    UnauthorizedError,
    requireSession: sessionMock.require,
  };
});

vi.mock("@/lib/server/prisma", () => ({
  prisma: { job: { updateMany: jobStore.updateMany } },
}));

import { POST } from "@/app/api/jobs/[id]/fit/route";

const JOB_ID = "550e8400-e29b-41d4-a716-446655440000";

const validMatrix = {
  requirements: [
    { id: "r1", type: "REQUIRED", requirement: "TypeScript", judgement: "MATCH" },
    { id: "r2", type: "REQUIRED", requirement: "Kubernetes", judgement: "GAP" },
    { id: "r3", type: "PREFERRED", requirement: "GraphQL", judgement: "PARTIAL" },
  ],
  eligibility: { status: "PASS", reasons: [] },
};

function fitRequest(body: unknown) {
  return new Request(`http://localhost/api/jobs/${JOB_ID}/fit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function ctx(id = JOB_ID) {
  return { params: Promise.resolve({ id }) };
}

describe("job fit import api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionMock.require.mockResolvedValue({ userId: "user-1" });
    jobStore.updateMany.mockResolvedValue({ count: 1 });
  });

  it("aggregates the matrix deterministically and persists the result", async () => {
    const response = await POST(
      fitRequest({ modelOutput: JSON.stringify(validMatrix), promptMeta: { resumeSnapshotUpdatedAt: "2026-07-15T00:00:00.000Z" } }),
      ctx(),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    // REQUIRED avg 0.5 -> 50 (weight 30); PREFERRED 0.5 -> 50 (weight 10) => 50.
    expect(json).toMatchObject({
      jobId: JOB_ID,
      fitScore: 50,
      rawFitScore: 50,
      fitVerdict: "MODERATE",
      fitEligibility: "PASS",
      gateStatus: "CLEAR",
      gateCap: null,
    });
    expect(jobStore.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: JOB_ID, userId: "user-1" },
        data: expect.objectContaining({
          fitScore: 50,
          fitVerdict: "MODERATE",
          fitSource: "local_ai",
          fitSnapshotHash: "2026-07-15T00:00:00.000Z",
        }),
      }),
    );
  });

  it("caps a confirmed hard gate and returns explainable gap metadata", async () => {
    const gatedMatrix = {
      requirements: [
        {
          id: "r1",
          type: "REQUIRED",
          criticality: "GATE",
          category: "TECHNICAL",
          requirement: "Kubernetes production experience",
          judgement: "GAP",
          jdEvidence: "Kubernetes experience is mandatory",
          note: "No Kubernetes evidence",
        },
        {
          id: "r2",
          type: "RESPONSIBILITY",
          criticality: "CORE",
          category: "RESPONSIBILITY",
          requirement: "Lead platform delivery",
          judgement: "MATCH",
        },
      ],
      eligibility: { status: "PASS", reasons: [] },
    };
    const response = await POST(
      fitRequest({ modelOutput: JSON.stringify(gatedMatrix) }),
      ctx(),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      fitScore: 29,
      gateStatus: "BLOCKED",
      gateCap: 29,
      criticalGaps: [
        {
          id: "r1",
          requirement: "Kubernetes production experience",
          judgement: "GAP",
          category: "TECHNICAL",
        },
      ],
    });
    expect(json.rawFitScore).toBeGreaterThan(29);
  });

  it("tolerates prose around the JSON object", async () => {
    const response = await POST(
      fitRequest({ modelOutput: `Here is the result:\n${JSON.stringify(validMatrix)}\nDone.` }),
      ctx(),
    );
    expect(response.status).toBe(200);
  });

  it("rejects an invalid matrix with the stable INVALID_AI_RESULT code", async () => {
    const response = await POST(
      fitRequest({ modelOutput: JSON.stringify({ requirements: [], eligibility: { status: "PASS", reasons: [] } }) }),
      ctx(),
    );
    const json = await response.json();
    expect(response.status).toBe(400);
    expect(json.error.code).toBe("INVALID_AI_RESULT");
    expect(jobStore.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a model-supplied score field (model must not score)", async () => {
    const withScore = { ...validMatrix, score: 95 };
    const response = await POST(
      fitRequest({ modelOutput: JSON.stringify(withScore) }),
      ctx(),
    );
    expect(response.status).toBe(400);
  });

  it("returns 404 when the job belongs to another user", async () => {
    jobStore.updateMany.mockResolvedValue({ count: 0 });
    const response = await POST(
      fitRequest({ modelOutput: JSON.stringify(validMatrix) }),
      ctx(),
    );
    expect(response.status).toBe(404);
  });
});
