import { describe, expect, it, vi } from "vitest";
import {
  completeTailoringRunAcceptance,
  hashManualTailoringAcceptance,
  prepareTailoringRunAcceptance,
  probeTailoringRunAcceptanceReplay,
} from "./tailoringRunAcceptance";
import type {
  TailoringReceiptRow,
  TailoringRunRow,
  TailoringRunTransaction,
} from "./tailoringRunDatabase";
import type { TailoringAcceptanceRequest } from "./tailoringRunTypes";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const JOB_ID = "22222222-2222-4222-8222-222222222222";
const RUN_ID = "33333333-3333-4333-8333-333333333333";
const ATTEMPT_A = "44444444-4444-4444-8444-444444444444";
const ATTEMPT_B = "55555555-5555-4555-8555-555555555555";
const TASK_ATTEMPT = "66666666-6666-4666-8666-666666666666";

function runRow(patch: Partial<TailoringRunRow> = {}): TailoringRunRow {
  return {
    id: RUN_ID,
    userId: USER_ID,
    jobId: JOB_ID,
    resumeProfileId: null,
    applicationBatchTaskId: null,
    applicationId: null,
    source: "MANUAL_IMPORT",
    delivery: "DRAFT",
    status: "RUNNING",
    requiredTargetMask: 1,
    acceptedTargetMask: 0,
    publicationRequiredTargetMask: 0,
    publishedTargetMask: 0,
    issueKey: "issue",
    issueHash: "issue-hash",
    promptReceipts: { RESUME: { promptHash: "prompt-hash" } },
    resumeSnapshotHash: "resume-snapshot",
    jobSnapshotHash: "job-snapshot",
    executionAttemptId: ATTEMPT_A,
    executionLeaseExpiresAt: new Date("2026-07-26T01:00:00.000Z"),
    attempt: 1,
    errorCode: null,
    errorMessage: null,
    startedAt: new Date("2026-07-26T00:00:00.000Z"),
    terminalAt: null,
    ...patch,
  };
}

function request(
  patch: Partial<TailoringAcceptanceRequest> = {},
): TailoringAcceptanceRequest {
  return {
    handle: { id: RUN_ID, attemptId: ATTEMPT_A },
    source: "MANUAL_IMPORT",
    delivery: "DRAFT",
    target: "RESUME",
    requestHash: "request-hash",
    promptHash: "prompt-hash",
    resumeSnapshotHash: "resume-snapshot",
    jobSnapshotHash: "job-snapshot",
    ...patch,
  };
}

function transaction(
  run: TailoringRunRow,
  receipts: TailoringReceiptRow[] = [],
): TailoringRunTransaction {
  return {
    $executeRaw: vi.fn(async () => 0),
    tailoringRun: {
      findUnique: vi.fn(),
      findFirst: vi.fn(async () => run),
      findMany: vi.fn(async () => []),
      create: vi.fn(),
      update: vi.fn(async () => run),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    tailoringRunReceipt: {
      findMany: vi.fn(async () => receipts),
      create: vi.fn(),
    },
    tailoringRunPublicationReceipt: {
      findMany: vi.fn(async () => []),
      create: vi.fn(),
    },
    applicationBatchTask: {
      findFirst: vi.fn(),
      updateMany: vi.fn(async () => ({ count: 1 })),
      groupBy: vi.fn(async () => []),
    },
    applicationBatch: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    job: { findFirst: vi.fn() },
    resumeProfile: { findFirst: vi.fn() },
    application: {
      findFirst: vi.fn(async () => ({
        id: "77777777-7777-4777-8777-777777777777",
        status: "DRAFT",
        aiContent: { schemaVersion: 1 },
        aiContentHash: "current-content-hash",
        resumePdfName: "Jane Engineer_CV.pdf",
        job: {
          id: JOB_ID,
          title: "Engineer",
          company: "Example Co",
          location: "Sydney",
        },
      })),
    },
  } as unknown as TailoringRunTransaction;
}

function existingReceipt(
  patch: Partial<TailoringReceiptRow> = {},
): TailoringReceiptRow {
  return {
    runId: RUN_ID,
    target: "RESUME",
    executionAttemptId: ATTEMPT_A,
    requestHash: "request-hash",
    applicationId: "77777777-7777-4777-8777-777777777777",
    aiContentHash: "content-hash",
    documentContentHash: null,
    delivery: "DRAFT",
    ...patch,
  };
}

describe("probeTailoringRunAcceptanceReplay", () => {
  it("returns the owned current Application for an exact durable receipt", async () => {
    const applicationId = "77777777-7777-4777-8777-777777777777";
    const tx = transaction(
      runRow({
        status: "SUCCEEDED",
        acceptedTargetMask: 1,
        applicationId,
        executionAttemptId: ATTEMPT_B,
        terminalAt: new Date(),
      }),
      [existingReceipt({ applicationId })],
    );

    const replay = await probeTailoringRunAcceptanceReplay(
      tx as Parameters<typeof probeTailoringRunAcceptanceReplay>[0],
      {
        userId: USER_ID,
        jobId: JOB_ID,
        request: {
          handle: { id: RUN_ID, attemptId: ATTEMPT_A },
          source: "MANUAL_IMPORT",
          delivery: "DRAFT",
          target: "RESUME",
          requestHash: "request-hash",
          promptHash: "prompt-hash",
        },
      },
    );

    expect(replay).toMatchObject({
      receipt: {
        applicationId,
        requestHash: "request-hash",
        documentContentHash: null,
      },
      application: {
        id: applicationId,
        status: "DRAFT",
        aiContentHash: "current-content-hash",
        job: { id: JOB_ID, title: "Engineer" },
      },
    });
  });

  it("returns null when the target has no durable receipt", async () => {
    const tx = transaction(runRow());
    await expect(
      probeTailoringRunAcceptanceReplay(
        tx as Parameters<typeof probeTailoringRunAcceptanceReplay>[0],
        {
          userId: USER_ID,
          jobId: JOB_ID,
          request: {
            handle: { id: RUN_ID, attemptId: ATTEMPT_A },
            source: "MANUAL_IMPORT",
            delivery: "DRAFT",
            target: "RESUME",
            requestHash: "request-hash",
            promptHash: "prompt-hash",
          },
        },
      ),
    ).resolves.toBeNull();
  });

  it("conflicts before returning an accepted target with different content", async () => {
    const applicationId = "77777777-7777-4777-8777-777777777777";
    const tx = transaction(runRow({ acceptedTargetMask: 1, applicationId }), [
      existingReceipt({ applicationId, requestHash: "first-content" }),
    ]);
    await expect(
      probeTailoringRunAcceptanceReplay(
        tx as Parameters<typeof probeTailoringRunAcceptanceReplay>[0],
        {
          userId: USER_ID,
          jobId: JOB_ID,
          request: {
            handle: { id: RUN_ID, attemptId: ATTEMPT_A },
            source: "MANUAL_IMPORT",
            delivery: "DRAFT",
            target: "RESUME",
            requestHash: "second-content",
            promptHash: "prompt-hash",
          },
        },
      ),
    ).rejects.toMatchObject({ code: "RECEIPT_CONFLICT", status: 409 });
  });

  it("rejects a receipt whose Application is not owned and associated", async () => {
    const applicationId = "77777777-7777-4777-8777-777777777777";
    const tx = transaction(runRow({ acceptedTargetMask: 1, applicationId }), [
      existingReceipt({ applicationId }),
    ]);
    vi.mocked(
      (tx as Parameters<typeof probeTailoringRunAcceptanceReplay>[0])
        .application.findFirst,
    ).mockResolvedValue(null);

    await expect(
      probeTailoringRunAcceptanceReplay(
        tx as Parameters<typeof probeTailoringRunAcceptanceReplay>[0],
        {
          userId: USER_ID,
          jobId: JOB_ID,
          request: {
            handle: { id: RUN_ID, attemptId: ATTEMPT_A },
            source: "MANUAL_IMPORT",
            delivery: "DRAFT",
            target: "RESUME",
            requestHash: "request-hash",
            promptHash: "prompt-hash",
          },
        },
      ),
    ).rejects.toMatchObject({ code: "RECEIPT_CONFLICT" });
  });

  it("hashes the canonical public command without persisting raw output", () => {
    const first = hashManualTailoringAcceptance({
      target: "RESUME",
      delivery: "DRAFT",
      promptHash: "prompt-hash",
      modelOutput: '{"cvSummary":"hello"}',
    });
    const replay = hashManualTailoringAcceptance({
      target: "RESUME",
      delivery: "DRAFT",
      promptHash: "prompt-hash",
      modelOutput: '{"cvSummary":"hello"}',
    });
    const changed = hashManualTailoringAcceptance({
      target: "RESUME",
      delivery: "DRAFT",
      promptHash: "prompt-hash",
      modelOutput: '{"cvSummary":"changed"}',
    });

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(replay).toBe(first);
    expect(changed).not.toBe(first);
  });

  it("rejects a private executor identifier before reading replay state", async () => {
    const tx = transaction(runRow());
    await expect(
      probeTailoringRunAcceptanceReplay(
        tx as Parameters<typeof probeTailoringRunAcceptanceReplay>[0],
        {
          userId: USER_ID,
          jobId: JOB_ID,
          request: {
            handle: { id: RUN_ID, attemptId: ATTEMPT_A },
            source: "MANUAL_IMPORT",
            delivery: "DRAFT",
            target: "RESUME",
            requestHash: "request-hash",
            promptHash: "hermes:run_private-executor",
          },
        },
      ),
    ).rejects.toMatchObject({ code: "RECEIPT_CONFLICT" });
    expect(tx.tailoringRun.findFirst).not.toHaveBeenCalled();
  });
});

describe("prepareTailoringRunAcceptance", () => {
  it("replays a matching receipt before checking a stale attempt", async () => {
    const run = runRow({
      status: "SUCCEEDED",
      executionAttemptId: ATTEMPT_B,
      terminalAt: new Date(),
    });
    const tx = transaction(run, [existingReceipt()]);

    const prepared = await prepareTailoringRunAcceptance(tx, {
      userId: USER_ID,
      jobId: JOB_ID,
      requests: [request()],
    });

    expect(prepared.pending).toEqual([]);
    expect(prepared.replayed).toHaveLength(1);
    expect(prepared.runs).toEqual([]);
  });

  it("conflicts when the accepted target has different content", async () => {
    const tx = transaction(runRow(), [
      existingReceipt({ requestHash: "first-content" }),
    ]);
    await expect(
      prepareTailoringRunAcceptance(tx, {
        userId: USER_ID,
        jobId: JOB_ID,
        requests: [request({ requestHash: "second-content" })],
      }),
    ).rejects.toMatchObject({ code: "RECEIPT_CONFLICT" });
  });

  it("checks the Application Job binding before receipt replay", async () => {
    const tx = transaction(runRow(), [existingReceipt()]);
    await expect(
      prepareTailoringRunAcceptance(tx, {
        userId: USER_ID,
        jobId: "88888888-8888-4888-8888-888888888888",
        requests: [request()],
      }),
    ).rejects.toMatchObject({ code: "JOB_MISMATCH" });
  });

  it("rejects private executor identifiers before acquiring locks", async () => {
    const tx = transaction(runRow());
    await expect(
      prepareTailoringRunAcceptance(tx, {
        userId: USER_ID,
        jobId: JOB_ID,
        requests: [request({ requestHash: "hermes:run_private-executor" })],
      }),
    ).rejects.toMatchObject({ code: "RECEIPT_CONFLICT" });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
});

describe("completeTailoringRunAcceptance", () => {
  it("keeps a v2 batch running after both draft targets are durable but unpublished", async () => {
    const task = {
      id: "99999999-9999-4999-8999-999999999999",
      batchId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      userId: USER_ID,
      jobId: JOB_ID,
      status: "RUNNING",
      executionAttemptId: TASK_ATTEMPT,
      tailoringProtocolVersion: 2,
      completionAttemptId: null,
    };
    const run = runRow({
      source: "CODEX_BATCH",
      delivery: "DRAFT",
      requiredTargetMask: 3,
      acceptedTargetMask: 1,
      publicationRequiredTargetMask: 3,
      publishedTargetMask: 0,
      applicationBatchTaskId: task.id,
      applicationBatchTask: task,
      promptReceipts: { COVER: { promptHash: "cover-prompt" } },
    });
    const tx = transaction(run);
    vi.mocked(tx.tailoringRunReceipt.create).mockImplementation(async (args) =>
      args.data as TailoringReceiptRow,
    );
    const prepared = await prepareTailoringRunAcceptance(tx, {
      userId: USER_ID,
      jobId: JOB_ID,
      requests: [
        request({
          source: "CODEX_BATCH",
          delivery: "DRAFT",
          target: "COVER",
          promptHash: "cover-prompt",
          requestHash: "cover-request",
          batchExecutionAttemptId: TASK_ATTEMPT,
        }),
      ],
    });

    const completed = await completeTailoringRunAcceptance(tx, {
      prepared,
      applicationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      aiContentHash: "aggregate-content-hash",
      documentContentHashes: { COVER: "cover-document-content-hash" },
    });

    expect(completed.completedRunIds).toEqual([]);
    expect(tx.tailoringRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          acceptedTargetMask: 3,
          applicationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        }),
      }),
    );
    expect(tx.tailoringRun.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "SUCCEEDED" }) }),
    );
    expect(tx.applicationBatchTask.updateMany).not.toHaveBeenCalled();
  });

  it("commits the last target, receipt, task, and batch projection together", async () => {
    const task = {
      id: "99999999-9999-4999-8999-999999999999",
      batchId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      userId: USER_ID,
      jobId: JOB_ID,
      status: "RUNNING",
      executionAttemptId: TASK_ATTEMPT,
      tailoringProtocolVersion: 1,
      completionAttemptId: null,
    };
    const run = runRow({
      source: "CODEX_BATCH",
      delivery: "FINAL",
      requiredTargetMask: 3,
      acceptedTargetMask: 1,
      applicationBatchTaskId: task.id,
      applicationBatchTask: task,
      promptReceipts: { COVER: { promptHash: "cover-prompt" } },
    });
    const tx = transaction(run);
    const receiptCreate = vi.mocked(tx.tailoringRunReceipt.create);
    receiptCreate.mockImplementation(async (args) => {
      const data = args.data as TailoringReceiptRow;
      return data;
    });
    vi.mocked(tx.applicationBatch.findFirst).mockResolvedValue({
      id: task.batchId,
      status: "RUNNING",
      startedAt: new Date(),
      completedAt: null,
    });
    vi.mocked(tx.applicationBatchTask.groupBy).mockResolvedValue([
      { status: "SUCCEEDED", _count: { _all: 1 } },
    ]);
    const pending = request({
      source: "CODEX_BATCH",
      delivery: "FINAL",
      target: "COVER",
      promptHash: "cover-prompt",
      requestHash: "cover-request",
      batchExecutionAttemptId: TASK_ATTEMPT,
    });
    const prepared = await prepareTailoringRunAcceptance(tx, {
      userId: USER_ID,
      jobId: JOB_ID,
      requests: [pending],
    });

    const completed = await completeTailoringRunAcceptance(tx, {
      prepared,
      applicationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      aiContentHash: "aggregate-content-hash",
      documentContentHashes: {
        COVER: "cover-document-content-hash",
      },
    });

    expect(completed.completedRunIds).toEqual([RUN_ID]);
    expect(completed.receipts).toEqual([
      expect.objectContaining({
        target: "COVER",
        documentContentHash: "cover-document-content-hash",
      }),
    ]);
    expect(tx.tailoringRunReceipt.create).toHaveBeenCalledOnce();
    expect(tx.tailoringRunReceipt.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          target: "COVER",
          executionAttemptId: ATTEMPT_A,
          documentContentHash: "cover-document-content-hash",
        }),
      }),
    );
    expect(tx.tailoringRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          acceptedTargetMask: 3,
          status: "SUCCEEDED",
        }),
      }),
    );
    expect(tx.applicationBatchTask.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          executionAttemptId: TASK_ATTEMPT,
          tailoringProtocolVersion: 1,
        }),
        data: expect.objectContaining({
          status: "SUCCEEDED",
          completionAttemptId: TASK_ATTEMPT,
        }),
      }),
    );
    expect(tx.applicationBatch.update).toHaveBeenCalledOnce();
    const lockCalls = vi.mocked(tx.$executeRaw).mock.calls;
    expect(lockCalls[0]?.[1]).toBe(0x544a4f42);
    expect(lockCalls[1]?.[1]).toBe(0x41424154);
    expect(lockCalls[2]?.[1]).toBe(0x544c524e);
  });

  it("rejects a new receipt without the accepted target content hash", async () => {
    const tx = transaction(runRow());
    const prepared = await prepareTailoringRunAcceptance(tx, {
      userId: USER_ID,
      jobId: JOB_ID,
      requests: [request()],
    });

    await expect(
      completeTailoringRunAcceptance(tx, {
        prepared,
        applicationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        aiContentHash: "aggregate-content-hash",
        documentContentHashes: {},
      }),
    ).rejects.toMatchObject({ code: "RECEIPT_CONFLICT", status: 409 });
    expect(tx.tailoringRunReceipt.create).not.toHaveBeenCalled();
  });

  it("never persists a private executor id as an AI content hash", async () => {
    const tx = transaction(runRow());
    await expect(
      completeTailoringRunAcceptance(tx, {
        prepared: {
          userId: USER_ID,
          pending: [],
          replayed: [],
          runs: [],
        },
        applicationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        aiContentHash: "hermes:run_private-executor",
        documentContentHashes: {},
      }),
    ).rejects.toMatchObject({ code: "RECEIPT_CONFLICT" });
    expect(tx.tailoringRunReceipt.create).not.toHaveBeenCalled();
  });
});
