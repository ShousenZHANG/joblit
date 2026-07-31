import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  buildPrompt: vi.fn(),
  transaction: vi.fn(),
  executeRaw: vi.fn(),
  jobUpdateMany: vi.fn(),
  receiptFindUnique: vi.fn(),
  receiptCreate: vi.fn(),
}));

vi.mock("@/lib/server/applications/applicationPrompt", () => ({
  buildTriagePromptForUser: dependencies.buildPrompt,
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    $transaction: dependencies.transaction,
    fitBatchImportReceipt: {
      findUnique: dependencies.receiptFindUnique,
    },
  },
}));

import {
  FitBatchImportError,
  readFitBatchSettlement,
  settleFitBatchImport,
} from "@/lib/server/jobs/fitBatchImport";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const JOB_A = "22222222-2222-4222-8222-222222222222";
const JOB_B = "33333333-3333-4333-8333-333333333333";
const CLAIM_TOKEN = "44444444-4444-4444-8444-444444444444";
const ISSUE_KEY = "a".repeat(64);
const PROMPT_META = {
  ruleSetId: "rules-1",
  resumeSnapshotUpdatedAt: "2026-07-31T00:00:00.000Z",
  promptTemplateVersion: "2026.07.v2",
  schemaVersion: "2026-07-24",
  skillPackVersion: "b".repeat(64),
  promptHash: "c".repeat(64),
};

type StoredReceipt = {
  userId: string;
  issueKey: string;
  requestHash: string;
  settlement: unknown;
};

function request(modelOutput = JSON.stringify([
  { jobId: JOB_A, matchScore: 82 },
  { jobId: JOB_B, matchScore: 41 },
])) {
  return {
    userId: USER_ID,
    jobIds: [JOB_B, JOB_A],
    claimToken: CLAIM_TOKEN,
    issueKey: ISSUE_KEY,
    modelOutput,
    promptMeta: PROMPT_META,
  };
}

describe("Fit batch import receipt", () => {
  const receipts = new Map<string, StoredReceipt>();

  beforeEach(() => {
    vi.clearAllMocks();
    receipts.clear();
    dependencies.buildPrompt.mockReset().mockResolvedValue({
      issueKey: ISSUE_KEY,
      promptMeta: PROMPT_META,
    });
    dependencies.executeRaw.mockResolvedValue(0);
    dependencies.jobUpdateMany.mockResolvedValue({ count: 1 });
    dependencies.receiptFindUnique.mockImplementation(
      async ({ where }: { where: { userId_issueKey: { userId: string; issueKey: string } } }) =>
        receipts.get(
          `${where.userId_issueKey.userId}:${where.userId_issueKey.issueKey}`,
        ) ?? null,
    );
    dependencies.receiptCreate.mockImplementation(
      async ({ data }: { data: StoredReceipt }) => {
        receipts.set(`${data.userId}:${data.issueKey}`, data);
        return data;
      },
    );
    dependencies.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback({
        $executeRaw: dependencies.executeRaw,
        job: { updateMany: dependencies.jobUpdateMany },
        fitBatchImportReceipt: {
          findUnique: dependencies.receiptFindUnique,
          create: dependencies.receiptCreate,
        },
      }),
    );
  });

  it("returns the exact durable settlement when the first response was lost", async () => {
    const first = await settleFitBatchImport(request());

    // Simulate time passing after the database commit: replay must not rebuild
    // a now-different prompt or touch the already-scored Jobs.
    dependencies.buildPrompt.mockRejectedValueOnce(
      new Error("profile changed after settlement"),
    );
    const replay = await settleFitBatchImport(request());

    expect(replay).toEqual(first);
    expect(replay).toEqual({
      protocolVersion: 1,
      issueKey: ISSUE_KEY,
      requestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      scored: [
        { jobId: JOB_A, fitScore: 82, fitVerdict: "STRONG" },
        { jobId: JOB_B, fitScore: 41, fitVerdict: "WEAK" },
      ],
    });
    expect(dependencies.jobUpdateMany).toHaveBeenCalledTimes(2);
    expect(dependencies.receiptCreate).toHaveBeenCalledTimes(1);
    expect(dependencies.buildPrompt).toHaveBeenCalledTimes(1);
  });

  it("rejects a conflicting replay instead of returning another request's receipt", async () => {
    await settleFitBatchImport(request());

    const conflict = await settleFitBatchImport(
      request(JSON.stringify([{ jobId: JOB_A, matchScore: 10 }])),
    ).catch((error) => error);

    expect(conflict).toBeInstanceOf(FitBatchImportError);
    expect(conflict).toMatchObject({
      code: "FIT_RECEIPT_CONFLICT",
      status: 409,
    });
    expect(dependencies.receiptCreate).toHaveBeenCalledTimes(1);
  });

  it("verifies a first import against the server-owned Fit issue", async () => {
    const mismatch = await settleFitBatchImport({
      ...request(),
      issueKey: "f".repeat(64),
    }).catch((error) => error);

    expect(mismatch).toMatchObject({
      code: "FIT_ISSUE_MISMATCH",
      status: 409,
    });
    expect(dependencies.transaction).not.toHaveBeenCalled();
    expect(dependencies.jobUpdateMany).not.toHaveBeenCalled();
  });

  it("reads a durable settlement for startup recovery without rebuilding the prompt", async () => {
    const first = await settleFitBatchImport(request());

    expect(await readFitBatchSettlement(USER_ID, ISSUE_KEY)).toEqual(first);
    expect(dependencies.buildPrompt).toHaveBeenCalledTimes(1);
    expect(dependencies.jobUpdateMany).toHaveBeenCalledTimes(2);
  });

  it("rejects persisted recovery data whose issue identity was corrupted", async () => {
    receipts.set(`${USER_ID}:${ISSUE_KEY}`, {
      userId: USER_ID,
      issueKey: ISSUE_KEY,
      requestHash: "e".repeat(64),
      settlement: {
        protocolVersion: 1,
        issueKey: "f".repeat(64),
        requestHash: "e".repeat(64),
        scored: [
          { jobId: JOB_A, fitScore: 82, fitVerdict: "STRONG" },
        ],
      },
    });

    await expect(readFitBatchSettlement(USER_ID, ISSUE_KEY)).rejects.toMatchObject({
      code: "FIT_RECEIPT_INVALID",
      status: 500,
    });
  });
});
