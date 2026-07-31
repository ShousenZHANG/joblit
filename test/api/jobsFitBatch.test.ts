import { beforeEach, describe, expect, it, vi } from "vitest";

const sessionMock = vi.hoisted(() => ({ require: vi.fn() }));
const promptMock = vi.hoisted(() => ({ build: vi.fn() }));
const txMock = vi.hoisted(() => ({
  transaction: vi.fn(),
  executeRaw: vi.fn(),
  updateMany: vi.fn(),
  receiptFindUnique: vi.fn(),
  receiptCreate: vi.fn(),
}));

vi.mock("@/lib/server/auth/requireSession", () => {
  class UnauthorizedError extends Error {}
  return { UnauthorizedError, requireSession: sessionMock.require };
});

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    $transaction: txMock.transaction,
    fitBatchImportReceipt: { findUnique: txMock.receiptFindUnique },
    job: { updateMany: txMock.updateMany },
  },
}));

vi.mock("@/lib/server/applications/applicationPrompt", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/lib/server/applications/applicationPrompt")
    >();
  return { ...actual, buildTriagePromptForUser: promptMock.build };
});

import { POST } from "@/app/api/jobs/fit/batch-import/route";
import { POST as settlementStatusPOST } from "@/app/api/jobs/fit/settlement-status/route";

const JOB_A = "11111111-1111-4111-8111-111111111111";
const JOB_B = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const CLAIM_TOKEN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ISSUE_KEY = "a".repeat(64);
const PROMPT_META = {
  ruleSetId: "rules-1",
  resumeSnapshotUpdatedAt: "2026-07-31T00:00:00.000Z",
  promptTemplateVersion: "2026.07.v2",
  schemaVersion: "2026-07-24",
  skillPackVersion: "b".repeat(64),
  promptHash: "c".repeat(64),
};

function batchRequest(body: unknown) {
  return new Request("http://localhost/api/jobs/fit/batch-import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      issueKey: ISSUE_KEY,
      promptMeta: PROMPT_META,
      ...(body as Record<string, unknown>),
    }),
  });
}

describe("batch fit import api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionMock.require.mockResolvedValue({ userId: "user-1" });
    promptMock.build.mockResolvedValue({
      issueKey: ISSUE_KEY,
      promptMeta: PROMPT_META,
    });
    txMock.receiptFindUnique.mockResolvedValue(null);
    txMock.receiptCreate.mockImplementation(async ({ data }) => data);
    txMock.executeRaw.mockResolvedValue(0);
    txMock.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback({
        $executeRaw: txMock.executeRaw,
        job: { updateMany: txMock.updateMany },
        fitBatchImportReceipt: {
          findUnique: txMock.receiptFindUnique,
          create: txMock.receiptCreate,
        },
      }),
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
    expect(json.settlement).toMatchObject({
      protocolVersion: 1,
      issueKey: ISSUE_KEY,
      requestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      scored: [
      { jobId: JOB_A, fitScore: 12, fitVerdict: "POOR" },
      { jobId: JOB_B, fitScore: 82, fitVerdict: "STRONG" },
      ],
    });
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

describe("fit settlement recovery api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionMock.require.mockResolvedValue({ userId: "user-1" });
  });

  it("returns only the validated receipt owned by the authenticated user", async () => {
    const requestHash = "f".repeat(64);
    txMock.receiptFindUnique.mockResolvedValue({
      requestHash,
      settlement: {
        protocolVersion: 1,
        issueKey: ISSUE_KEY,
        requestHash,
        scored: [
          { jobId: JOB_A, fitScore: 82, fitVerdict: "STRONG" },
        ],
      },
    });

    const response = await settlementStatusPOST(
      new Request("http://localhost/api/jobs/fit/settlement-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issueKey: ISSUE_KEY }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      settlement: {
        protocolVersion: 1,
        issueKey: ISSUE_KEY,
        requestHash,
        scored: [
          { jobId: JOB_A, fitScore: 82, fitVerdict: "STRONG" },
        ],
      },
    });
    expect(txMock.receiptFindUnique).toHaveBeenCalledWith({
      where: {
        userId_issueKey: { userId: "user-1", issueKey: ISSUE_KEY },
      },
      select: { requestHash: true, settlement: true },
    });
  });

  it("returns null when the issue has no durable settlement", async () => {
    txMock.receiptFindUnique.mockResolvedValue(null);

    const response = await settlementStatusPOST(
      new Request("http://localhost/api/jobs/fit/settlement-status", {
        method: "POST",
        body: JSON.stringify({ issueKey: ISSUE_KEY }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ settlement: null });
  });
});
