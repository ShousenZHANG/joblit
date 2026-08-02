import { beforeEach, describe, expect, it, vi } from "vitest";

import { Prisma } from "@/lib/generated/prisma";
import { buildPromptSnapshotHash } from "@/lib/server/ai/promptContract";

const dependencies = vi.hoisted(() => ({
  buildPrompt: vi.fn(),
  transaction: vi.fn(),
  executeRaw: vi.fn(),
  jobUpdateMany: vi.fn(),
  receiptFindUnique: vi.fn(),
  receiptCreate: vi.fn(),
  claimFindFirst: vi.fn(),
  claimUpdate: vi.fn(),
  claimItemUpdate: vi.fn(),
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
    fitBatchClaim: {
      findFirst: dependencies.claimFindFirst,
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

function issuedPrompt() {
  return {
    requestId: "req-fit-test",
    issueKey: ISSUE_KEY,
    prompt: {
      input: "score these jobs",
      instructions: "return JSON",
      sessionId: ISSUE_KEY,
    },
    promptMeta: PROMPT_META,
    expectedJsonShape: "[]",
    expectedJsonSchema: { type: "array" as const },
    promptVersion: "v4-application-proposal",
    snapshotBinding: {
      resumeProfileId: "66666666-6666-4666-8666-666666666666",
      resumeSnapshotHash: "d".repeat(64),
      jobSnapshotHash: "e".repeat(64),
    },
  };
}

type StoredReceipt = {
  userId: string;
  issueKey: string;
  requestHash: string;
  settlement: unknown;
};

function request(
  modelOutput = JSON.stringify([
    { jobId: JOB_A, matchScore: 82 },
    { jobId: JOB_B, matchScore: 41 },
  ]),
) {
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
    vi.resetAllMocks();
    receipts.clear();
    dependencies.buildPrompt.mockReset().mockResolvedValue(issuedPrompt());
    dependencies.executeRaw.mockResolvedValue(0);
    dependencies.jobUpdateMany.mockResolvedValue({ count: 1 });
    dependencies.claimFindFirst.mockResolvedValue(null);
    dependencies.claimUpdate.mockResolvedValue({});
    dependencies.claimItemUpdate.mockResolvedValue({});
    dependencies.receiptFindUnique.mockImplementation(
      async ({
        where,
      }: {
        where: { userId_issueKey: { userId: string; issueKey: string } };
      }) =>
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
    dependencies.transaction.mockImplementation(
      async (callback: (tx: unknown) => unknown) =>
        callback({
          $executeRaw: dependencies.executeRaw,
          job: { updateMany: dependencies.jobUpdateMany },
          fitBatchImportReceipt: {
            findUnique: dependencies.receiptFindUnique,
            create: dependencies.receiptCreate,
          },
          fitBatchClaim: {
            findFirst: dependencies.claimFindFirst,
            update: dependencies.claimUpdate,
          },
          fitBatchClaimItem: { update: dependencies.claimItemUpdate },
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
      failed: [],
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

  it("recovers the receipt when a rolling v1 importer wins the unique key", async () => {
    dependencies.receiptCreate.mockImplementationOnce(
      async ({ data }: { data: StoredReceipt }) => {
        receipts.set(`${data.userId}:${data.issueKey}`, data);
        throw new Prisma.PrismaClientKnownRequestError(
          "Unique constraint failed on FitBatchImportReceipt",
          {
            code: "P2002",
            clientVersion: "7.9.0",
            meta: { target: ["userId", "issueKey"] },
          },
        );
      },
    );

    const settlement = await settleFitBatchImport(request());

    expect(settlement).toMatchObject({
      issueKey: ISSUE_KEY,
      scored: [
        { jobId: JOB_A, fitScore: 82 },
        { jobId: JOB_B, fitScore: 41 },
      ],
      failed: [],
    });
    expect(dependencies.receiptFindUnique).toHaveBeenCalledTimes(4);
  });

  it("reconciles an old partial v1 receipt without rebuilding changed prompt state", async () => {
    const body = request(JSON.stringify([{ jobId: JOB_A, matchScore: 82 }]));
    const first = await settleFitBatchImport(body);
    const receiptKey = `${USER_ID}:${ISSUE_KEY}`;
    const stored = receipts.get(receiptKey)!;
    receipts.set(receiptKey, {
      ...stored,
      // A pre-durable v1 receipt had no failed member and could omit Jobs.
      settlement: {
        protocolVersion: first.protocolVersion,
        issueKey: first.issueKey,
        requestHash: first.requestHash,
        scored: first.scored,
      },
    });
    dependencies.buildPrompt.mockClear();
    dependencies.jobUpdateMany.mockClear();
    dependencies.claimItemUpdate.mockClear();
    dependencies.claimUpdate.mockClear();
    const claimId = "55555555-5555-4555-8555-555555555555";
    dependencies.claimFindFirst.mockResolvedValue({
      id: claimId,
      status: "ACTIVE",
      issueKey: null,
      executionAttemptId: CLAIM_TOKEN,
      items: [{ jobId: JOB_A }, { jobId: JOB_B }],
    });

    const replay = await settleFitBatchImport(body);

    expect(replay.failed).toEqual([]);
    expect(dependencies.buildPrompt).not.toHaveBeenCalled();
    expect(dependencies.claimItemUpdate).toHaveBeenCalledTimes(2);
    expect(dependencies.jobUpdateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: { in: [JOB_B] },
        fitSource: `claim:${CLAIM_TOKEN}`,
      }),
      data: { fitSource: null },
    });
    expect(dependencies.claimUpdate).toHaveBeenCalledWith({
      where: { id: claimId },
      data: expect.objectContaining({
        status: "SUPERSEDED",
        executionLeaseExpiresAt: null,
        errorCode: "LEGACY_RECEIPT_RECONCILED",
        terminalAt: expect.any(Date),
      }),
    });
  });

  it("records every omitted legacy Job exactly once", async () => {
    const settlement = await settleFitBatchImport(
      request(JSON.stringify([{ jobId: JOB_A, matchScore: 82 }])),
    );

    expect(settlement).toMatchObject({
      scored: [{ jobId: JOB_A, fitScore: 82, fitVerdict: "STRONG" }],
      failed: [{ jobId: JOB_B, code: "MODEL_RESULT_MISSING" }],
    });
    expect(settlement.scored).toHaveLength(1);
    expect(settlement.failed).toHaveLength(1);
  });

  it("distinguishes an unavailable omitted legacy Job from a model omission", async () => {
    dependencies.jobUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const settlement = await settleFitBatchImport(
      request(JSON.stringify([{ jobId: JOB_A, matchScore: 82 }])),
    );

    expect(settlement.failed).toEqual([
      { jobId: JOB_B, code: "JOB_UNAVAILABLE" },
    ]);
  });

  it("rejects a v1 receipt when the token owns none of the requested Jobs", async () => {
    dependencies.jobUpdateMany.mockResolvedValue({ count: 0 });

    await expect(settleFitBatchImport(request())).rejects.toMatchObject({
      code: "FIT_CLAIM_EXPIRED",
      status: 409,
    });
    expect(dependencies.receiptCreate).not.toHaveBeenCalled();
  });

  it("settles a durable Claim with exact scored and unavailable outcomes", async () => {
    const claimId = "55555555-5555-4555-8555-555555555555";
    dependencies.claimFindFirst.mockResolvedValue({
      id: claimId,
      status: "ACTIVE",
      issueKey: ISSUE_KEY,
      protocolVersion: 2,
      executionAttemptId: CLAIM_TOKEN,
      executionLeaseExpiresAt: new Date(Date.now() + 60_000),
      promptMeta: PROMPT_META,
      promptMetaHash: buildPromptSnapshotHash(PROMPT_META),
      items: [{ jobId: JOB_A }, { jobId: JOB_B }],
    });
    dependencies.jobUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const settlement = await settleFitBatchImport(
      request(JSON.stringify([{ jobId: JOB_A, matchScore: 82 }])),
    );

    expect(settlement).toMatchObject({
      scored: [{ jobId: JOB_A, fitScore: 82, fitVerdict: "STRONG" }],
      failed: [{ jobId: JOB_B, code: "JOB_UNAVAILABLE" }],
    });
    expect(dependencies.claimItemUpdate).toHaveBeenCalledTimes(2);
    expect(dependencies.claimUpdate).toHaveBeenCalledWith({
      where: { id: claimId },
      data: expect.objectContaining({
        status: "SETTLED",
        executionLeaseExpiresAt: null,
        settledAt: expect.any(Date),
      }),
    });
  });

  it("binds an unbound durable attempt before atomic settlement", async () => {
    const claimId = "55555555-5555-4555-8555-555555555555";
    const lease = new Date(Date.now() + 60_000);
    const items = [{ jobId: JOB_A }, { jobId: JOB_B }];
    const unbound = {
      id: claimId,
      status: "ACTIVE",
      issueKey: null,
      executionAttemptId: CLAIM_TOKEN,
      executionLeaseExpiresAt: lease,
      issueHash: null,
      promptHash: null,
      promptMetaHash: null,
      items,
    };
    const bound = {
      ...unbound,
      issueKey: ISSUE_KEY,
      protocolVersion: 2,
      promptMeta: PROMPT_META,
      promptMetaHash: buildPromptSnapshotHash(PROMPT_META),
    };
    dependencies.claimFindFirst
      .mockResolvedValueOnce(unbound)
      .mockResolvedValueOnce(unbound)
      .mockResolvedValueOnce({ id: claimId })
      .mockResolvedValueOnce(bound);

    const settlement = await settleFitBatchImport(request());

    expect(settlement.scored).toHaveLength(2);
    expect(dependencies.buildPrompt).toHaveBeenCalledTimes(1);
    expect(dependencies.claimUpdate).toHaveBeenNthCalledWith(1, {
      where: { id: claimId },
      data: expect.objectContaining({
        issueKey: ISSUE_KEY,
        promptMeta: PROMPT_META,
        promptMetaHash: buildPromptSnapshotHash(PROMPT_META),
      }),
    });
    expect(dependencies.receiptCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        claimId,
        executionAttemptId: CLAIM_TOKEN,
        protocolVersion: 2,
      }),
    });
    expect(dependencies.claimUpdate).toHaveBeenLastCalledWith({
      where: { id: claimId },
      data: expect.objectContaining({
        status: "SETTLED",
        executionLeaseExpiresAt: null,
        settledAt: expect.any(Date),
      }),
    });
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

  it("rejects duplicate model Job identities before any write", async () => {
    const duplicate = await settleFitBatchImport(
      request(
        JSON.stringify([
          { jobId: JOB_A, matchScore: 82 },
          { jobId: JOB_A, matchScore: 41 },
        ]),
      ),
    ).catch((error) => error);

    expect(duplicate).toMatchObject({
      code: "INVALID_AI_RESULT",
      status: 400,
    });
    expect(dependencies.transaction).not.toHaveBeenCalled();
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
        scored: [{ jobId: JOB_A, fitScore: 82, fitVerdict: "STRONG" }],
      },
    });

    await expect(
      readFitBatchSettlement(USER_ID, ISSUE_KEY),
    ).rejects.toMatchObject({
      code: "FIT_RECEIPT_INVALID",
      status: 500,
    });
  });

  it("rejects persisted settlements with duplicate or overlapping Job outcomes", async () => {
    const requestHash = "e".repeat(64);
    const corruptedSettlements = [
      {
        protocolVersion: 1,
        issueKey: ISSUE_KEY,
        requestHash,
        scored: [
          { jobId: JOB_A, fitScore: 82, fitVerdict: "STRONG" },
          { jobId: JOB_A, fitScore: 82, fitVerdict: "STRONG" },
        ],
      },
      {
        protocolVersion: 1,
        issueKey: ISSUE_KEY,
        requestHash,
        scored: [{ jobId: JOB_A, fitScore: 82, fitVerdict: "STRONG" }],
        failed: [{ jobId: JOB_A, code: "JOB_UNAVAILABLE" }],
      },
    ];

    for (const settlement of corruptedSettlements) {
      receipts.set(`${USER_ID}:${ISSUE_KEY}`, {
        userId: USER_ID,
        issueKey: ISSUE_KEY,
        requestHash,
        settlement,
      });
      await expect(
        readFitBatchSettlement(USER_ID, ISSUE_KEY),
      ).rejects.toMatchObject({
        code: "FIT_RECEIPT_INVALID",
        status: 500,
      });
    }
  });
});
