import { describe, expect, it, vi } from "vitest";

import type {
  TailoringPublicationReceiptRow,
  TailoringReceiptRow,
  TailoringRunRow,
  TailoringRunTransaction,
} from "./tailoringRunDatabase";
import {
  completeTailoringRunPublication,
  prepareTailoringRunPublication,
} from "./tailoringRunPublication";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const JOB_ID = "22222222-2222-4222-8222-222222222222";
const RUN_ID = "33333333-3333-4333-8333-333333333333";
const ATTEMPT_ID = "44444444-4444-4444-8444-444444444444";
const TASK_ID = "55555555-5555-4555-8555-555555555555";
const BATCH_ID = "66666666-6666-4666-8666-666666666666";
const APPLICATION_ID = "77777777-7777-4777-8777-777777777777";

function runRow(patch: Partial<TailoringRunRow> = {}): TailoringRunRow {
  return {
    id: RUN_ID,
    userId: USER_ID,
    jobId: JOB_ID,
    resumeProfileId: "88888888-8888-4888-8888-888888888888",
    applicationBatchTaskId: TASK_ID,
    applicationId: APPLICATION_ID,
    source: "CODEX_BATCH",
    delivery: "DRAFT",
    status: "RUNNING",
    requiredTargetMask: 3,
    acceptedTargetMask: 3,
    publicationRequiredTargetMask: 3,
    publishedTargetMask: 0,
    issueKey: "issue",
    issueHash: "issue-hash",
    promptReceipts: {},
    resumeSnapshotHash: "resume-snapshot",
    jobSnapshotHash: "job-snapshot",
    executionAttemptId: ATTEMPT_ID,
    executionLeaseExpiresAt: new Date("2026-08-10T02:00:00.000Z"),
    attempt: 1,
    errorCode: null,
    errorMessage: null,
    startedAt: new Date("2026-08-10T01:00:00.000Z"),
    terminalAt: null,
    applicationBatchTask: {
      id: TASK_ID,
      batchId: BATCH_ID,
      userId: USER_ID,
      jobId: JOB_ID,
      status: "RUNNING",
      executionAttemptId: ATTEMPT_ID,
      tailoringProtocolVersion: 2,
      completionAttemptId: null,
    },
    ...patch,
  };
}

function accepted(target: "RESUME" | "COVER"): TailoringReceiptRow {
  return {
    runId: RUN_ID,
    target,
    executionAttemptId: ATTEMPT_ID,
    requestHash: `${target.toLowerCase()}-request`,
    applicationId: APPLICATION_ID,
    aiContentHash: "aggregate-hash",
    documentContentHash: `${target.toLowerCase()}-document-hash`,
    delivery: "DRAFT",
  };
}

function transaction(run = runRow()): TailoringRunTransaction {
  const publicationReceipts: TailoringPublicationReceiptRow[] = [];
  const tx = {
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
      findMany: vi.fn(async () => [accepted("RESUME"), accepted("COVER")]),
      create: vi.fn(),
    },
    tailoringRunPublicationReceipt: {
      findMany: vi.fn(async () => publicationReceipts),
      create: vi.fn(async (args) => {
        const row = args.data as TailoringPublicationReceiptRow;
        publicationReceipts.push(row);
        return row;
      }),
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
  };
  return tx as unknown as TailoringRunTransaction;
}

describe("Tailoring Run publication", () => {
  it("records one published target without completing the task", async () => {
    const tx = transaction();
    const prepared = await prepareTailoringRunPublication(tx, {
      userId: USER_ID,
      jobId: JOB_ID,
      applicationId: APPLICATION_ID,
      request: {
        handle: { id: RUN_ID, attemptId: ATTEMPT_ID },
        applicationId: APPLICATION_ID,
        target: "RESUME",
        batchExecutionAttemptId: ATTEMPT_ID,
      },
    });

    const completed = await completeTailoringRunPublication(tx, {
      prepared,
      applicationId: APPLICATION_ID,
      documentContentHash: "resume-document-hash",
    });

    expect(completed.completed).toBe(false);
    expect(tx.tailoringRunPublicationReceipt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        runId: RUN_ID,
        target: "RESUME",
        documentContentHash: "resume-document-hash",
      }),
    });
    expect(tx.tailoringRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ publishedTargetMask: 1 }),
      }),
    );
    expect(tx.applicationBatchTask.updateMany).not.toHaveBeenCalled();
  });

  it("completes the task only when the second accepted target is published", async () => {
    const tx = transaction(runRow({ publishedTargetMask: 1 }));
    vi.mocked(tx.applicationBatch.findFirst).mockResolvedValueOnce({
      id: BATCH_ID,
      status: "RUNNING",
      startedAt: new Date("2026-08-10T01:00:00.000Z"),
      completedAt: null,
    });
    vi.mocked(tx.applicationBatchTask.groupBy).mockResolvedValueOnce([
      { status: "SUCCEEDED", _count: { _all: 1 } },
    ]);
    const prepared = await prepareTailoringRunPublication(tx, {
      userId: USER_ID,
      jobId: JOB_ID,
      applicationId: APPLICATION_ID,
      request: {
        handle: { id: RUN_ID, attemptId: ATTEMPT_ID },
        applicationId: APPLICATION_ID,
        target: "COVER",
        batchExecutionAttemptId: ATTEMPT_ID,
      },
    });

    const completed = await completeTailoringRunPublication(tx, {
      prepared,
      applicationId: APPLICATION_ID,
      documentContentHash: "cover-document-hash",
    });

    expect(completed.completed).toBe(true);
    expect(tx.tailoringRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          publishedTargetMask: 3,
          status: "SUCCEEDED",
        }),
      }),
    );
    expect(tx.applicationBatchTask.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tailoringProtocolVersion: 2,
          executionAttemptId: ATTEMPT_ID,
        }),
        data: expect.objectContaining({
          status: "SUCCEEDED",
          completionAttemptId: ATTEMPT_ID,
        }),
      }),
    );
  });

  it("replays an immutable publication receipt without a second write", async () => {
    const tx = transaction(runRow({ publishedTargetMask: 1 }));
    const receipt: TailoringPublicationReceiptRow = {
      runId: RUN_ID,
      target: "RESUME",
      executionAttemptId: ATTEMPT_ID,
      applicationId: APPLICATION_ID,
      documentContentHash: "resume-document-hash",
    };
    vi.mocked(tx.tailoringRunPublicationReceipt.findMany).mockResolvedValueOnce([
      receipt,
    ]);

    const prepared = await prepareTailoringRunPublication(tx, {
      userId: USER_ID,
      jobId: JOB_ID,
      applicationId: APPLICATION_ID,
      request: {
        handle: { id: RUN_ID, attemptId: ATTEMPT_ID },
        applicationId: APPLICATION_ID,
        target: "RESUME",
        batchExecutionAttemptId: ATTEMPT_ID,
      },
    });
    const result = await completeTailoringRunPublication(tx, {
      prepared,
      applicationId: APPLICATION_ID,
      documentContentHash: "resume-document-hash",
    });

    expect(result).toEqual({ completed: false, receipt });
    expect(tx.tailoringRunPublicationReceipt.create).not.toHaveBeenCalled();
    expect(tx.tailoringRun.update).not.toHaveBeenCalled();
  });
});
