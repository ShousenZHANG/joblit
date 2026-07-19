import { beforeEach, describe, expect, it, vi } from "vitest";

const sessionMock = vi.hoisted(() => ({ require: vi.fn() }));
const txMock = vi.hoisted(() => ({ transaction: vi.fn(), updateMany: vi.fn() }));

vi.mock("@/lib/server/auth/requireSession", () => {
  class UnauthorizedError extends Error {}
  return { UnauthorizedError, requireSession: sessionMock.require };
});

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    $transaction: txMock.transaction,
    job: { updateMany: txMock.updateMany },
  },
}));

import { POST } from "@/app/api/jobs/fit/batch-import/route";

const JOB_A = "11111111-1111-4111-8111-111111111111";
const JOB_B = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const CLAIM_TOKEN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function batchRequest(body: unknown) {
  return new Request("http://localhost/api/jobs/fit/batch-import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("batch fit import api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionMock.require.mockResolvedValue({ userId: "user-1" });
    txMock.transaction.mockImplementation(async (operations: Promise<unknown>[]) =>
      Promise.all(operations),
    );
    txMock.updateMany.mockResolvedValue({ count: 1 });
  });

  it("bands each score deterministically and persists only batch jobs", async () => {
    const output = JSON.stringify([
      { jobId: JOB_A, matchScore: 12, reason: "different profession" },
      { jobId: JOB_B, matchScore: 82, reason: "core stack matches" },
      { jobId: OTHER, matchScore: 99, reason: "not in this batch" },
    ]);
    const response = await POST(batchRequest({
      jobIds: [JOB_A, JOB_B],
      claimToken: CLAIM_TOKEN,
      modelOutput: output,
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.scored).toEqual([
      { jobId: JOB_A, fitScore: 12, fitVerdict: "POOR" },
      { jobId: JOB_B, fitScore: 82, fitVerdict: "STRONG" },
    ]);
    // The out-of-batch job was dropped, not written.
    expect(txMock.updateMany).toHaveBeenCalledTimes(2);
    expect(txMock.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ fitSource: `claim:${CLAIM_TOKEN}` }),
      }),
    );
  });

  it("tolerates prose around the JSON array", async () => {
    const output = `Sure:\n[{"jobId":"${JOB_A}","matchScore":40}]\nDone.`;
    const response = await POST(batchRequest({
      jobIds: [JOB_A],
      claimToken: CLAIM_TOKEN,
      modelOutput: output,
    }));
    expect(response.status).toBe(200);
  });

  it("rejects an out-of-range score with INVALID_AI_RESULT", async () => {
    const output = JSON.stringify([{ jobId: JOB_A, matchScore: 250 }]);
    const response = await POST(batchRequest({
      jobIds: [JOB_A],
      claimToken: CLAIM_TOKEN,
      modelOutput: output,
    }));
    const json = await response.json();
    expect(response.status).toBe(400);
    expect(json.error.code).toBe("INVALID_AI_RESULT");
    expect(txMock.transaction).not.toHaveBeenCalled();
  });

  it("rejects when no returned entry belongs to the batch", async () => {
    const output = JSON.stringify([{ jobId: OTHER, matchScore: 50 }]);
    const response = await POST(batchRequest({
      jobIds: [JOB_A],
      claimToken: CLAIM_TOKEN,
      modelOutput: output,
    }));
    const json = await response.json();
    expect(response.status).toBe(400);
    expect(json.error.code).toBe("INVALID_AI_RESULT");
  });

  it("rejects a result after its database claim has expired", async () => {
    txMock.updateMany.mockResolvedValueOnce({ count: 0 });
    const output = JSON.stringify([{ jobId: JOB_A, matchScore: 70 }]);

    const response = await POST(batchRequest({
      jobIds: [JOB_A],
      claimToken: CLAIM_TOKEN,
      modelOutput: output,
    }));

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("FIT_CLAIM_EXPIRED");
  });
});
