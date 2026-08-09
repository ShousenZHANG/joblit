import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/prisma", () => ({ prisma: {} }));

import {
  bindTailoringRunPrompt,
  cancelTailoringRun,
  failTailoringRun,
  issueTailoringRun,
  startTailoringRun,
} from "./tailoringRunService";
import {
  type TailoringRunDatabase,
  type TailoringRunRow,
  type TailoringRunTransaction,
} from "./tailoringRunDatabase";
import { TailoringRunError } from "./tailoringRunProtocol";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const JOB_ID = "22222222-2222-4222-8222-222222222222";
const RUN_ID = "33333333-3333-4333-8333-333333333333";
const ATTEMPT_A = "44444444-4444-4444-8444-444444444444";
const ATTEMPT_B = "55555555-5555-4555-8555-555555555555";
const TASK_ID = "66666666-6666-4666-8666-666666666666";
const BATCH_ID = "77777777-7777-4777-8777-777777777777";

function baseRun(patch: Partial<TailoringRunRow> = {}): TailoringRunRow {
  return {
    id: RUN_ID,
    userId: USER_ID,
    jobId: JOB_ID,
    resumeProfileId: null,
    applicationBatchTaskId: null,
    applicationId: null,
    source: "MANUAL_IMPORT",
    delivery: "DRAFT",
    status: "ISSUED",
    requiredTargetMask: 1,
    acceptedTargetMask: 0,
    issueKey: "manual:job:resume",
    issueHash: "issue-hash",
    promptReceipts: {},
    resumeSnapshotHash: "resume-snapshot",
    jobSnapshotHash: "job-snapshot",
    executionAttemptId: null,
    executionLeaseExpiresAt: null,
    attempt: 0,
    errorCode: null,
    errorMessage: null,
    startedAt: null,
    terminalAt: null,
    ...patch,
  };
}

function databaseFor(tx: TailoringRunTransaction): TailoringRunDatabase {
  return {
    ...tx,
    $transaction: vi.fn(async (callback) => callback(tx)),
  };
}

function mutableRunTransaction(initial: TailoringRunRow) {
  let run = initial;
  const update = vi.fn(async (args: Record<string, unknown>) => {
    const data = args.data as Record<string, unknown>;
    const attempt =
      data.attempt && typeof data.attempt === "object"
        ? run.attempt + 1
        : typeof data.attempt === "number"
          ? data.attempt
          : run.attempt;
    run = { ...run, ...data, attempt } as TailoringRunRow;
    return run;
  });
  const tx = {
    $executeRaw: vi.fn(async () => 0),
    tailoringRun: {
      findFirst: vi.fn(async (args?: Record<string, unknown>) => {
        const where = args?.where as { status?: { in?: string[] } } | undefined;
        return where?.status?.in ? null : run;
      }),
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => run),
      update,
      updateMany: vi.fn(async () => ({ count: 0 })),
      create: vi.fn(),
    },
    tailoringRunReceipt: {
      findMany: vi.fn(async () => []),
      create: vi.fn(),
    },
    applicationBatchTask: {
      findFirst: vi.fn(),
      updateMany: vi.fn(async () => ({ count: 1 })),
      groupBy: vi.fn(),
    },
    applicationBatch: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    job: { findFirst: vi.fn() },
    resumeProfile: { findFirst: vi.fn() },
  } as unknown as TailoringRunTransaction;
  return { tx, update, getRun: () => run };
}

function issueInput() {
  return {
    userId: USER_ID,
    issueKey: "manual:job:resume",
    jobId: JOB_ID,
    source: "MANUAL_IMPORT" as const,
    delivery: "DRAFT" as const,
    requiredTargets: ["RESUME" as const],
    resumeSnapshotHash: "resume-snapshot",
    jobSnapshotHash: "job-snapshot",
  };
}

describe("TailoringRun issue/start/bind lifecycle", () => {
  it("rejects a second active generation owner for the same Job", async () => {
    const setup = mutableRunTransaction(baseRun());
    vi.mocked(setup.tx.tailoringRun.findUnique).mockResolvedValue(null);
    vi.mocked(setup.tx.tailoringRun.findFirst).mockResolvedValueOnce(
      baseRun({ issueKey: "another-active-run", status: "RUNNING" }),
    );
    vi.mocked(setup.tx.job.findFirst).mockResolvedValue({ id: JOB_ID });

    await expect(
      issueTailoringRun(issueInput(), {
        database: databaseFor(setup.tx),
      }),
    ).rejects.toMatchObject({ code: "ATTEMPT_ACTIVE" });
    expect(setup.tx.tailoringRun.create).not.toHaveBeenCalled();
  });

  it("rejects a fresh batch run when an Application appeared after queueing", async () => {
    const setup = mutableRunTransaction(baseRun());
    vi.mocked(setup.tx.tailoringRun.findUnique).mockResolvedValue(null);
    vi.mocked(setup.tx.tailoringRun.findFirst).mockResolvedValue(null);
    vi.mocked(setup.tx.applicationBatchTask.findFirst).mockResolvedValue({
      id: TASK_ID,
      batchId: BATCH_ID,
      userId: USER_ID,
      jobId: JOB_ID,
      status: "RUNNING",
      executionAttemptId: ATTEMPT_A,
      tailoringProtocolVersion: 1,
      completionAttemptId: null,
    });
    vi.mocked(setup.tx.job.findFirst)
      .mockResolvedValueOnce({ id: JOB_ID })
      .mockResolvedValueOnce(null);

    await expect(
      issueTailoringRun(
        {
          ...issueInput(),
          issueKey: `server-batch:${TASK_ID}`,
          source: "SERVER_BATCH",
          delivery: "FINAL",
          requiredTargets: ["RESUME", "COVER"],
          batch: {
            taskId: TASK_ID,
            batchId: BATCH_ID,
            executionAttemptId: ATTEMPT_A,
          },
        },
        { database: databaseFor(setup.tx) },
      ),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(setup.tx.tailoringRun.create).not.toHaveBeenCalled();
  });

  it("replays the same issue and conflicts when its bound inputs change", async () => {
    let stored: TailoringRunRow | null = null;
    const setup = mutableRunTransaction(baseRun());
    vi.mocked(setup.tx.tailoringRun.findUnique).mockImplementation(
      async () => stored,
    );
    vi.mocked(setup.tx.tailoringRun.create).mockImplementation(async (args) => {
      const data = args.data as Partial<TailoringRunRow>;
      stored = baseRun({ ...data, id: String(data.id) });
      return stored;
    });
    vi.mocked(setup.tx.job.findFirst).mockResolvedValue({ id: JOB_ID });
    const database = databaseFor(setup.tx);

    const first = await issueTailoringRun(issueInput(), { database });
    const replay = await issueTailoringRun(issueInput(), { database });

    expect(first.disposition).toBe("APPLIED");
    expect(replay.disposition).toBe("REPLAYED");
    // The exact key replays before stale-run retirement, preserving recovery
    // for an expired lease whose caller still owns the durable issue key.
    expect(setup.tx.tailoringRun.findMany).toHaveBeenCalledTimes(1);
    await expect(
      issueTailoringRun(
        { ...issueInput(), jobSnapshotHash: "changed-job-snapshot" },
        { database },
      ),
    ).rejects.toMatchObject({ code: "ISSUE_KEY_CONFLICT" });
  });

  it("reuses one batch run after task reclaim but validates the new attempt", async () => {
    let stored: TailoringRunRow | null = null;
    let taskAttempt = ATTEMPT_A;
    const setup = mutableRunTransaction(baseRun());
    vi.mocked(setup.tx.tailoringRun.findUnique).mockImplementation(
      async (args) => {
        const where = args.where as {
          userId_issueKey?: { userId: string; issueKey: string };
        };
        if (!where.userId_issueKey) return null;
        return stored?.userId === where.userId_issueKey.userId &&
          stored.issueKey === where.userId_issueKey.issueKey
          ? stored
          : null;
      },
    );
    vi.mocked(setup.tx.tailoringRun.findFirst).mockImplementation(
      async (args) => {
        const where = args.where as {
          applicationBatchTaskId?: string;
          userId?: string;
        };
        if (!stored) return null;
        return stored.applicationBatchTaskId === where.applicationBatchTaskId &&
          stored.userId === where.userId
          ? stored
          : null;
      },
    );
    vi.mocked(setup.tx.tailoringRun.create).mockImplementation(async (args) => {
      const data = args.data as Partial<TailoringRunRow>;
      stored = baseRun({ ...data, id: String(data.id) });
      return stored;
    });
    vi.mocked(setup.tx.applicationBatchTask.findFirst).mockImplementation(
      async () => ({
        id: TASK_ID,
        batchId: BATCH_ID,
        userId: USER_ID,
        jobId: JOB_ID,
        status: "RUNNING",
        executionAttemptId: taskAttempt,
        tailoringProtocolVersion: 1,
        completionAttemptId: null,
      }),
    );
    vi.mocked(setup.tx.job.findFirst).mockResolvedValue({ id: JOB_ID });
    const database = databaseFor(setup.tx);
    const input = {
      ...issueInput(),
      issueKey: `server-batch:${TASK_ID}`,
      source: "SERVER_BATCH" as const,
      delivery: "FINAL" as const,
      requiredTargets: ["RESUME" as const, "COVER" as const],
      batch: {
        taskId: TASK_ID,
        batchId: BATCH_ID,
        executionAttemptId: ATTEMPT_A,
      },
    };

    expect((await issueTailoringRun(input, { database })).disposition).toBe(
      "APPLIED",
    );
    taskAttempt = ATTEMPT_B;
    expect(
      (
        await issueTailoringRun(
          {
            ...input,
            batch: { ...input.batch, executionAttemptId: ATTEMPT_B },
          },
          { database },
        )
      ).disposition,
    ).toBe("REPLAYED");
    await expect(
      issueTailoringRun({ ...input, delivery: "DRAFT" }, { database }),
    ).rejects.toMatchObject({ code: "ISSUE_KEY_CONFLICT" });
    await expect(issueTailoringRun(input, { database })).rejects.toMatchObject({
      code: "BATCH_ATTEMPT_MISMATCH",
    });
    await expect(
      issueTailoringRun(
        {
          ...input,
          issueKey: `server-batch:duplicate:${TASK_ID}`,
          batch: { ...input.batch, executionAttemptId: ATTEMPT_B },
        },
        { database },
      ),
    ).rejects.toMatchObject({ code: "ISSUE_KEY_CONFLICT" });
  });

  it("renews the same attempt, rejects a fresh rival, then permits takeover", async () => {
    const setup = mutableRunTransaction(baseRun());
    const database = databaseFor(setup.tx);
    let now = new Date("2026-07-26T00:00:00.000Z");
    const deps = { database, now: () => now };

    const first = await startTailoringRun(
      { userId: USER_ID, runId: RUN_ID, attemptId: ATTEMPT_A },
      deps,
    );
    await startTailoringRun(
      { userId: USER_ID, runId: RUN_ID, attemptId: ATTEMPT_A },
      deps,
    );
    expect(first.handle).toEqual({ id: RUN_ID, attemptId: ATTEMPT_A });
    expect(setup.getRun().attempt).toBe(1);

    await expect(
      startTailoringRun(
        { userId: USER_ID, runId: RUN_ID, attemptId: ATTEMPT_B },
        deps,
      ),
    ).rejects.toMatchObject({ code: "ATTEMPT_ACTIVE" });

    now = new Date("2026-07-26T00:03:00.001Z");
    const takeover = await startTailoringRun(
      { userId: USER_ID, runId: RUN_ID, attemptId: ATTEMPT_B },
      deps,
    );
    expect(takeover.handle.attemptId).toBe(ATTEMPT_B);
    expect(setup.getRun().attempt).toBe(2);
  });

  it("binds one prompt once and rejects a different prompt", async () => {
    const setup = mutableRunTransaction(
      baseRun({
        status: "RUNNING",
        executionAttemptId: ATTEMPT_A,
      }),
    );
    const database = databaseFor(setup.tx);
    const input = {
      userId: USER_ID,
      runId: RUN_ID,
      target: "RESUME" as const,
      receipt: { promptHash: "prompt-hash" },
    };

    expect(
      (await bindTailoringRunPrompt(input, { database })).disposition,
    ).toBe("APPLIED");
    setup.getRun().status = "SUCCEEDED";
    expect(
      (await bindTailoringRunPrompt(input, { database })).disposition,
    ).toBe("REPLAYED");
    await expect(
      bindTailoringRunPrompt(
        { ...input, receipt: { promptHash: "other-prompt" } },
        { database },
      ),
    ).rejects.toMatchObject({ code: "PROMPT_CONFLICT" });
  });

  it("requires a batch run to project the task attempt", async () => {
    const task = {
      id: TASK_ID,
      batchId: BATCH_ID,
      userId: USER_ID,
      jobId: JOB_ID,
      status: "RUNNING",
      executionAttemptId: ATTEMPT_A,
      tailoringProtocolVersion: 1,
      completionAttemptId: null,
    };
    const setup = mutableRunTransaction(
      baseRun({
        source: "SERVER_BATCH",
        applicationBatchTaskId: TASK_ID,
        applicationBatchTask: task,
      }),
    );

    await expect(
      startTailoringRun(
        {
          userId: USER_ID,
          runId: RUN_ID,
          attemptId: ATTEMPT_B,
          batchExecutionAttemptId: ATTEMPT_A,
        },
        { database: databaseFor(setup.tx) },
      ),
    ).rejects.toMatchObject({ code: "BATCH_ATTEMPT_MISMATCH" });
  });

  it("lets the current reclaimed batch attempt supersede the old run lease", async () => {
    const task = {
      id: TASK_ID,
      batchId: BATCH_ID,
      userId: USER_ID,
      jobId: JOB_ID,
      status: "RUNNING",
      executionAttemptId: ATTEMPT_B,
      tailoringProtocolVersion: 1,
      completionAttemptId: null,
    };
    const setup = mutableRunTransaction(
      baseRun({
        source: "SERVER_BATCH",
        status: "RUNNING",
        executionAttemptId: ATTEMPT_A,
        executionLeaseExpiresAt: new Date("2026-07-26T01:00:00.000Z"),
        attempt: 1,
        applicationBatchTaskId: TASK_ID,
        applicationBatchTask: task,
      }),
    );

    const result = await startTailoringRun(
      {
        userId: USER_ID,
        runId: RUN_ID,
        attemptId: ATTEMPT_B,
        batchExecutionAttemptId: ATTEMPT_B,
      },
      {
        database: databaseFor(setup.tx),
        now: () => new Date("2026-07-26T00:30:00.000Z"),
      },
    );

    expect(result.handle.attemptId).toBe(ATTEMPT_B);
    expect(setup.getRun().attempt).toBe(2);
  });
});

describe("TailoringRun terminal transitions", () => {
  it("fails as PARTIAL when a target is already accepted", async () => {
    const setup = mutableRunTransaction(
      baseRun({
        status: "RUNNING",
        executionAttemptId: ATTEMPT_A,
        requiredTargetMask: 3,
        acceptedTargetMask: 1,
      }),
    );

    const result = await failTailoringRun(
      {
        userId: USER_ID,
        handle: { id: RUN_ID, attemptId: ATTEMPT_A },
        errorCode: "PROVIDER_FAILED",
        errorMessage: "private run_secret must not persist",
      },
      { database: databaseFor(setup.tx) },
    );

    expect(result.run.status).toBe("PARTIAL");
    expect(result.run.errorMessage).not.toContain("run_secret");
  });

  it("fences stale cancellation but replays a canonical terminal result", async () => {
    const setup = mutableRunTransaction(
      baseRun({
        status: "RUNNING",
        executionAttemptId: ATTEMPT_B,
      }),
    );
    const database = databaseFor(setup.tx);
    await expect(
      cancelTailoringRun(
        {
          userId: USER_ID,
          handle: { id: RUN_ID, attemptId: ATTEMPT_A },
        },
        { database },
      ),
    ).rejects.toMatchObject({ code: "ATTEMPT_STALE" });

    setup.getRun().status = "SUCCEEDED";
    const replay = await cancelTailoringRun(
      {
        userId: USER_ID,
        handle: { id: RUN_ID, attemptId: ATTEMPT_A },
      },
      { database },
    );
    expect(replay).toMatchObject({
      disposition: "REPLAYED",
      run: { status: "SUCCEEDED" },
    });
  });

  it("cannot use an old run handle to cancel a reclaimed batch task", async () => {
    const task = {
      id: TASK_ID,
      batchId: BATCH_ID,
      userId: USER_ID,
      jobId: JOB_ID,
      status: "RUNNING",
      executionAttemptId: ATTEMPT_B,
      tailoringProtocolVersion: 1,
      completionAttemptId: null,
    };
    const setup = mutableRunTransaction(
      baseRun({
        status: "RUNNING",
        source: "SERVER_BATCH",
        executionAttemptId: ATTEMPT_A,
        applicationBatchTaskId: TASK_ID,
        applicationBatchTask: task,
      }),
    );

    await expect(
      cancelTailoringRun(
        {
          userId: USER_ID,
          handle: { id: RUN_ID, attemptId: ATTEMPT_A },
        },
        { database: databaseFor(setup.tx) },
      ),
    ).rejects.toMatchObject({ code: "ATTEMPT_STALE" });
    expect(setup.tx.applicationBatchTask.updateMany).not.toHaveBeenCalled();
  });
});

it("exports stable typed protocol errors", () => {
  expect(new TailoringRunError("ATTEMPT_STALE", "stale")).toMatchObject({
    code: "ATTEMPT_STALE",
    status: 409,
  });
});
