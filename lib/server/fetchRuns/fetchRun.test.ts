import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  transaction: vi.fn(),
  ownerFindUnique: vi.fn(),
  statusFindFirst: vi.fn(),
  staleFindMany: vi.fn(),
  runFindUnique: vi.fn(),
  runFindFirst: vi.fn(),
  runUpdate: vi.fn(),
  runUpdateMany: vi.fn(),
  receiptFindUnique: vi.fn(),
  receiptCreate: vi.fn(),
  prepare: vi.fn(),
  persist: vi.fn(),
  lock: vi.fn(),
  reportError: vi.fn(),
  exists: true,
  persistCount: 2,
  invalidCount: 1,
  migrationRace: false,
  staleCandidateIds: [] as string[],
  run: {
    id: "550e8400-e29b-41d4-a716-446655440000",
    userId: "server-user",
    market: "AU",
    status: "QUEUED",
    error: null as string | null,
    importedCount: 0,
    invalidCount: 0,
    discoveredCount: 0,
    expectedBatchCount: null as number | null,
    nextBatchIndex: 0,
    commitStartedAt: null as Date | null,
    terminalAt: null as Date | null,
    executionAttemptId: null as string | null,
    executionLeaseExpiresAt: null as Date | null,
    queries: {
      title: "Platform Engineer",
      queries: ["Platform Engineer"],
      smartExpand: true,
    } as unknown,
    createdAt: new Date("2026-07-24T00:00:00.000Z"),
    updatedAt: new Date("2026-07-24T00:00:00.000Z"),
  },
  receipts: new Map<
    string,
    {
      requestHash: string;
      executionAttemptId: string;
      importedCount: number;
      invalidCount: number;
      batchIndex: number;
      batchCount: number;
      terminal: boolean;
    }
  >(),
  operations: [] as string[],
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    $transaction: harness.transaction,
    fetchRun: {
      findUnique: harness.ownerFindUnique,
      findFirst: harness.statusFindFirst,
      findMany: harness.staleFindMany,
    },
  },
}));

vi.mock("./fetchRunLifecycleLock", () => ({
  acquireFetchRunLifecycleLock: harness.lock,
}));

vi.mock("./fetchRunJobIntake", () => ({
  prepareFetchRunJobIntake: harness.prepare,
  persistFetchRunJobIntake: harness.persist,
  isFetchRunJobIntakeMigrationRace: () => harness.migrationRace,
}));

vi.mock("@/lib/server/observability/errorReporter", () => ({
  reportError: harness.reportError,
}));

import {
  FETCH_RUN_CANCELLED_ERROR,
  FETCH_RUN_COMMIT_PROTOCOL,
  cancelFetchRun,
  commitFetchRun as submitFetchRunCommand,
  getFetchRunStatus,
  sweepStaleFetchRuns,
  type FetchRunCommitCommand,
} from "./fetchRun";

const RUN_ID = "550e8400-e29b-41d4-a716-446655440000";
const ATTEMPT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ATTEMPT_ID = "22222222-2222-4222-8222-222222222222";

function commitFetchRun(command: FetchRunCommitCommand) {
  const { runId, ...wireCommand } = command;
  return submitFetchRunCommand({ runId, wireCommand });
}

function startCommand(attemptId = ATTEMPT_ID) {
  return {
    protocol: FETCH_RUN_COMMIT_PROTOCOL,
    command: "start" as const,
    runId: RUN_ID,
    attemptId,
  };
}

function commitCommand(
  overrides: Partial<
    Extract<
      Parameters<typeof commitFetchRun>[0],
      { command: "commit" }
    >
  > = {},
) {
  return {
    protocol: FETCH_RUN_COMMIT_PROTOCOL,
    command: "commit" as const,
    runId: RUN_ID,
    attemptId: ATTEMPT_ID,
    batchKey: "batch-0",
    batchIndex: 0,
    batchCount: 1,
    items: [
      {
        jobUrl: "https://example.com/jobs/1",
        title: "Platform Engineer",
        market: "AU" as const,
      },
    ],
    terminal: true,
    discoveredCount: 1,
    ...overrides,
  };
}

function failCommand(error = "source timed out", attemptId = ATTEMPT_ID) {
  return {
    protocol: FETCH_RUN_COMMIT_PROTOCOL,
    command: "fail" as const,
    runId: RUN_ID,
    attemptId,
    error,
  };
}

function receiptKey(fetchRunId: string, batchKey: string) {
  return `${fetchRunId}:${batchKey}`;
}

describe("FetchRun execution/commit protocol", () => {
  beforeEach(() => {
    harness.exists = true;
    harness.persistCount = 2;
    harness.invalidCount = 1;
    harness.migrationRace = false;
    harness.staleCandidateIds.length = 0;
    harness.run = {
      id: RUN_ID,
      userId: "server-user",
      market: "AU",
      status: "QUEUED",
      error: null,
      importedCount: 0,
      invalidCount: 0,
      discoveredCount: 0,
      expectedBatchCount: null,
      nextBatchIndex: 0,
      commitStartedAt: null,
      terminalAt: null,
      executionAttemptId: null,
      executionLeaseExpiresAt: null,
      queries: {
        title: "Platform Engineer",
        queries: ["Platform Engineer"],
        smartExpand: true,
      },
      createdAt: new Date("2026-07-24T00:00:00.000Z"),
      updatedAt: new Date("2026-07-24T00:00:00.000Z"),
    };
    harness.receipts.clear();
    harness.operations.length = 0;

    for (const mock of [
      harness.transaction,
      harness.ownerFindUnique,
      harness.statusFindFirst,
      harness.staleFindMany,
      harness.runFindUnique,
      harness.runFindFirst,
      harness.runUpdate,
      harness.runUpdateMany,
      harness.receiptFindUnique,
      harness.receiptCreate,
      harness.prepare,
      harness.persist,
      harness.lock,
      harness.reportError,
    ]) {
      mock.mockReset();
    }

    harness.transaction.mockImplementation(
      async (
        callback: (tx: {
          fetchRun: {
            findUnique: typeof harness.runFindUnique;
            findFirst: typeof harness.runFindFirst;
            update: typeof harness.runUpdate;
            updateMany: typeof harness.runUpdateMany;
          };
          fetchRunCommitReceipt: {
            findUnique: typeof harness.receiptFindUnique;
            create: typeof harness.receiptCreate;
          };
        }) => Promise<unknown>,
      ) =>
        callback({
          fetchRun: {
            findUnique: harness.runFindUnique,
            findFirst: harness.runFindFirst,
            update: harness.runUpdate,
            updateMany: harness.runUpdateMany,
          },
          fetchRunCommitReceipt: {
            findUnique: harness.receiptFindUnique,
            create: harness.receiptCreate,
          },
        }),
    );
    harness.ownerFindUnique.mockImplementation(async () =>
      harness.exists
        ? { userId: harness.run.userId, market: harness.run.market }
        : null,
    );
    harness.statusFindFirst.mockImplementation(async () =>
      harness.exists ? { ...harness.run } : null,
    );
    harness.staleFindMany.mockImplementation(async () =>
      harness.staleCandidateIds.map((id) => ({ id })),
    );
    harness.runFindUnique.mockImplementation(async () =>
      harness.exists ? { ...harness.run } : null,
    );
    harness.runFindFirst.mockImplementation(async ({ where }) => {
      if (!harness.exists) return null;
      if (where?.userId && where.userId !== harness.run.userId) return null;
      return { ...harness.run };
    });
    harness.runUpdate.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => {
        harness.operations.push("projection");
        for (const [key, value] of Object.entries(data)) {
          if (
            value &&
            typeof value === "object" &&
            "increment" in value
          ) {
            const increment = Number(
              (value as { increment: number }).increment,
            );
            const current = Number(
              harness.run[key as keyof typeof harness.run] ?? 0,
            );
            (harness.run as Record<string, unknown>)[key] =
              current + increment;
          } else {
            (harness.run as Record<string, unknown>)[key] = value;
          }
        }
        return { ...harness.run };
      },
    );
    harness.runUpdateMany.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => {
        if (!harness.exists || !["QUEUED", "RUNNING"].includes(harness.run.status)) {
          return { count: 0 };
        }
        Object.assign(harness.run, data);
        return { count: 1 };
      },
    );
    harness.receiptFindUnique.mockImplementation(
      async ({
        where,
      }: {
        where: {
          fetchRunId_batchKey: { fetchRunId: string; batchKey: string };
        };
      }) => {
        const key = where.fetchRunId_batchKey;
        return (
          harness.receipts.get(receiptKey(key.fetchRunId, key.batchKey)) ??
          null
        );
      },
    );
    harness.receiptCreate.mockImplementation(
      async ({
        data,
      }: {
        data: {
          fetchRunId: string;
          batchKey: string;
          requestHash: string;
          executionAttemptId: string;
          importedCount: number;
          invalidCount: number;
          batchIndex: number;
          batchCount: number;
          terminal: boolean;
        };
      }) => {
        harness.operations.push("receipt");
        harness.receipts.set(
          receiptKey(data.fetchRunId, data.batchKey),
          data,
        );
        return data;
      },
    );
    harness.prepare.mockImplementation(async ({ items }) => ({
      invalid: harness.invalidCount,
      observedAt: new Date("2026-07-24T00:00:00.000Z"),
      items,
    }));
    harness.persist.mockImplementation(async () => {
      harness.operations.push("persist");
      return harness.persistCount;
    });
    harness.lock.mockImplementation(async () => {
      harness.operations.push("lock");
    });
  });

  it("checks target existence and AU policy before parsing the worker body", async () => {
    harness.exists = false;
    await expect(
      submitFetchRunCommand({ runId: RUN_ID, wireCommand: null }),
    ).rejects.toMatchObject({ code: "RUN_NOT_FOUND", status: 404 });

    harness.exists = true;
    harness.run.market = "CN";
    await expect(
      submitFetchRunCommand({ runId: RUN_ID, wireCommand: null }),
    ).rejects.toMatchObject({ code: "RUN_MARKET_RETIRED", status: 410 });

    harness.run.market = "AU";
    await expect(
      submitFetchRunCommand({ runId: RUN_ID, wireCommand: null }),
    ).rejects.toMatchObject({
      code: "INVALID_BODY",
      status: 400,
      details: expect.anything(),
    });
    expect(harness.transaction).not.toHaveBeenCalled();
  });

  it("starts a queued run once and replays an already-running start", async () => {
    await expect(commitFetchRun(startCommand())).resolves.toEqual({
      disposition: "APPLIED",
      executionAttemptId: ATTEMPT_ID,
      batchImported: 0,
      batchInvalid: 0,
      totalImported: 0,
      status: "RUNNING",
    });
    await expect(commitFetchRun(startCommand())).resolves.toEqual({
      disposition: "REPLAYED",
      executionAttemptId: ATTEMPT_ID,
      batchImported: 0,
      batchInvalid: 0,
      totalImported: 0,
      status: "RUNNING",
    });

    expect(harness.run.status).toBe("RUNNING");
    expect(harness.run.executionAttemptId).toBe(ATTEMPT_ID);
    expect(harness.run.executionLeaseExpiresAt).toBeInstanceOf(Date);
    expect(harness.lock).toHaveBeenCalledTimes(2);
    expect(harness.runUpdate).toHaveBeenCalledTimes(2);
  });

  it("rejects a duplicate attempt while the canonical lease is active", async () => {
    await commitFetchRun(startCommand());

    await expect(
      commitFetchRun(startCommand(OTHER_ATTEMPT_ID)),
    ).rejects.toMatchObject({
      code: "EXECUTION_LEASE_HELD",
    });
    await expect(
      commitFetchRun(failCommand("duplicate discovery failed", OTHER_ATTEMPT_ID)),
    ).rejects.toMatchObject({
      code: "EXECUTION_LEASE_LOST",
    });
    expect(harness.run).toMatchObject({
      status: "RUNNING",
      error: null,
      executionAttemptId: ATTEMPT_ID,
    });
  });

  it("allows a new attempt to take over only after the prior lease expires", async () => {
    await commitFetchRun(startCommand());
    harness.run.executionLeaseExpiresAt = new Date("2000-01-01T00:00:00.000Z");

    await expect(
      commitFetchRun(startCommand(OTHER_ATTEMPT_ID)),
    ).resolves.toMatchObject({
      disposition: "APPLIED",
      status: "RUNNING",
    });
    expect(harness.run.executionAttemptId).toBe(OTHER_ATTEMPT_ID);
    await expect(commitFetchRun(commitCommand())).rejects.toMatchObject({
      code: "EXECUTION_LEASE_LOST",
    });
  });

  it("fences attempt A before replaying attempt B's terminal result", async () => {
    await commitFetchRun(startCommand());
    harness.run.executionLeaseExpiresAt = new Date("2000-01-01T00:00:00.000Z");
    await commitFetchRun(startCommand(OTHER_ATTEMPT_ID));
    await commitFetchRun(
      commitCommand({
        attemptId: OTHER_ATTEMPT_ID,
      }),
    );

    await expect(
      commitFetchRun(failCommand("attempt A resumed late")),
    ).rejects.toMatchObject({
      code: "EXECUTION_LEASE_LOST",
    });
    await expect(
      commitFetchRun(failCommand("attempt B replay", OTHER_ATTEMPT_ID)),
    ).resolves.toMatchObject({
      disposition: "REPLAYED",
      status: "SUCCEEDED",
    });
  });

  it("distinguishes a stale writer from a current writer's content conflict", async () => {
    await commitFetchRun(startCommand());
    await commitFetchRun(
      commitCommand({
        batchCount: 2,
        terminal: false,
      }),
    );
    harness.run.executionLeaseExpiresAt = new Date("2000-01-01T00:00:00.000Z");
    await commitFetchRun(startCommand(OTHER_ATTEMPT_ID));

    const changedBatch = {
      batchCount: 2,
      terminal: false,
      items: [
        {
          jobUrl: "https://example.com/jobs/changed",
          title: "Changed Engineer",
          market: "AU" as const,
        },
      ],
    };
    await expect(
      commitFetchRun(commitCommand(changedBatch)),
    ).rejects.toMatchObject({
      code: "EXECUTION_LEASE_LOST",
    });
    await expect(
      commitFetchRun(
        commitCommand({
          ...changedBatch,
          attemptId: OTHER_ATTEMPT_ID,
        }),
      ),
    ).rejects.toMatchObject({
      code: "BATCH_CONTENT_CONFLICT",
    });
  });

  it("returns the receipt owner when a successor replays identical content", async () => {
    await commitFetchRun(startCommand());
    const firstBatch = commitCommand({
      batchCount: 2,
      terminal: false,
    });
    await commitFetchRun(firstBatch);
    harness.run.executionLeaseExpiresAt = new Date("2000-01-01T00:00:00.000Z");
    await commitFetchRun(startCommand(OTHER_ATTEMPT_ID));

    await expect(
      commitFetchRun({
        ...firstBatch,
        attemptId: OTHER_ATTEMPT_ID,
      }),
    ).resolves.toMatchObject({
      disposition: "REPLAYED",
      executionAttemptId: ATTEMPT_ID,
      status: "RUNNING",
    });
  });

  it("applies a batch once and returns its durable receipt on replay", async () => {
    await commitFetchRun(startCommand());
    const command = commitCommand();

    await expect(commitFetchRun(command)).resolves.toMatchObject({
      disposition: "APPLIED",
      batchImported: 2,
      batchInvalid: 1,
      totalImported: 2,
      status: "SUCCEEDED",
    });
    await expect(commitFetchRun(command)).resolves.toMatchObject({
      disposition: "REPLAYED",
      batchImported: 2,
      batchInvalid: 1,
      totalImported: 2,
      status: "SUCCEEDED",
    });

    expect(harness.persist).toHaveBeenCalledTimes(1);
    expect(harness.receiptCreate).toHaveBeenCalledTimes(1);
  });

  it("rejects reuse of a batch key with different canonical content", async () => {
    await commitFetchRun(startCommand());
    await commitFetchRun(commitCommand());

    await expect(
      commitFetchRun(
        commitCommand({
          items: [
            {
              jobUrl: "https://example.com/jobs/2",
              title: "Different Engineer",
              market: "AU",
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({
      code: "BATCH_CONTENT_CONFLICT",
    });
    expect(harness.persist).toHaveBeenCalledTimes(1);
  });

  it("rejects out-of-order batches and a changed declared batch count", async () => {
    await commitFetchRun(startCommand());

    await expect(
      commitFetchRun(
        commitCommand({
          batchKey: "batch-1",
          batchIndex: 1,
          batchCount: 2,
        }),
      ),
    ).rejects.toMatchObject({
      code: "BATCH_OUT_OF_ORDER",
    });

    await commitFetchRun(
      commitCommand({
        batchCount: 2,
        terminal: false,
      }),
    );
    await expect(
      commitFetchRun(
        commitCommand({
          batchKey: "batch-1",
          batchIndex: 1,
          batchCount: 3,
          terminal: false,
        }),
      ),
    ).rejects.toMatchObject({
      code: "BATCH_STREAM_CONFLICT",
    });
  });

  it("persists the receipt and terminal projection in one transaction", async () => {
    await commitFetchRun(startCommand());
    harness.operations.length = 0;

    await commitFetchRun(
      commitCommand({
        discoveredCount: 7,
        terminalOutcome: "SUCCEEDED",
      }),
    );

    expect(harness.transaction).toHaveBeenCalledTimes(2);
    expect(harness.operations).toEqual([
      "lock",
      "persist",
      "receipt",
      "projection",
    ]);
    expect(harness.run).toMatchObject({
      status: "SUCCEEDED",
      error: null,
      importedCount: 2,
      invalidCount: 1,
      discoveredCount: 7,
      expectedBatchCount: 1,
      nextBatchIndex: 1,
      commitStartedAt: expect.any(Date),
      terminalAt: expect.any(Date),
    });
    expect(harness.receipts.get(receiptKey(RUN_ID, "batch-0"))).toMatchObject({
      importedCount: 2,
      invalidCount: 1,
      batchIndex: 0,
      batchCount: 1,
      terminal: true,
    });
  });

  it("retries the complete commit transaction without enrichment columns", async () => {
    const migrationError = Object.assign(
      new Error('The column "Job.source" does not exist'),
      { code: "P2022" },
    );
    harness.migrationRace = true;
    harness.persist
      .mockRejectedValueOnce(migrationError)
      .mockImplementationOnce(async () => {
        harness.operations.push("persist");
        return 1;
      });

    await commitFetchRun(startCommand());
    await expect(commitFetchRun(commitCommand())).resolves.toMatchObject({
      disposition: "APPLIED",
      batchImported: 1,
      status: "SUCCEEDED",
    });

    expect(harness.transaction).toHaveBeenCalledTimes(3);
    expect(harness.persist).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({ includeEnrichment: true }),
    );
    expect(harness.persist).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({ includeEnrichment: false }),
    );
    expect(harness.reportError).toHaveBeenCalledWith(
      migrationError,
      expect.objectContaining({ scope: "fetchRuns.commit.enrichment_migration_race" }),
    );
  });

  it("rejects a terminal batch that omits the total discovered count", async () => {
    await commitFetchRun(startCommand());

    await expect(
      commitFetchRun(commitCommand({ discoveredCount: undefined })),
    ).rejects.toMatchObject({
      code: "INVALID_BODY",
      status: 400,
    });
  });

  it.each([
    {
      status: "FAILED" as const,
      error: FETCH_RUN_CANCELLED_ERROR,
      code: "RUN_CANCELLED",
    },
    {
      status: "SUCCEEDED" as const,
      error: null,
      code: "RUN_ALREADY_TERMINAL",
    },
  ])("rejects a new commit when the run is $status", async ({ status, error, code }) => {
    harness.run.status = status;
    harness.run.error = error;

    await expect(commitFetchRun(commitCommand())).rejects.toMatchObject({
      code,
    });
    expect(harness.persist).not.toHaveBeenCalled();
    expect(harness.receiptCreate).not.toHaveBeenCalled();
  });

  it("projects fail as FAILED before any batch and PARTIAL after a receipt", async () => {
    await commitFetchRun(startCommand());
    await expect(commitFetchRun(failCommand("initial failure"))).resolves.toMatchObject({
      disposition: "APPLIED",
      status: "FAILED",
      totalImported: 0,
    });
    expect(harness.run.error).toBe("initial failure");

    harness.run = {
      ...harness.run,
      status: "QUEUED",
      error: null,
      importedCount: 0,
      invalidCount: 0,
      expectedBatchCount: null,
      nextBatchIndex: 0,
      commitStartedAt: null,
      terminalAt: null,
    };
    harness.receipts.clear();
    await commitFetchRun(startCommand());
    await commitFetchRun(
      commitCommand({
        batchCount: 2,
        terminal: false,
      }),
    );

    await expect(commitFetchRun(failCommand("second source failed"))).resolves.toMatchObject({
      disposition: "APPLIED",
      status: "PARTIAL",
      totalImported: 2,
    });
    expect(harness.run).toMatchObject({
      status: "PARTIAL",
      error: "second source failed",
      terminalAt: expect.any(Date),
    });
  });

  it("derives tenant and market from the run, never from adapter items", async () => {
    harness.run.userId = "authoritative-user";
    harness.run.market = "AU";
    await commitFetchRun(startCommand());

    await commitFetchRun(
      commitCommand({
        items: [
          {
            jobUrl: "https://example.com/jobs/1",
            title: "Platform Engineer",
            market: "CN",
            source: "forged-source",
          },
        ],
      }),
    );

    expect(harness.prepare).toHaveBeenCalledWith({
      userId: "authoritative-user",
      items: [
        expect.objectContaining({
          jobUrl: "https://example.com/jobs/1",
          market: "AU",
          source: "jobspy",
        }),
      ],
    });
    expect(harness.persist).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "authoritative-user",
      }),
    );
  });

  it.each(["CN", "GLOBAL"])(
    "rejects every external command for a retired %s run",
    async (market) => {
      harness.run.market = market;
      for (const command of [
        startCommand(),
        commitCommand(),
        failCommand(),
      ]) {
        await expect(commitFetchRun(command)).rejects.toMatchObject({
          code: "RUN_MARKET_RETIRED",
          status: 410,
        });
      }
      expect(harness.prepare).not.toHaveBeenCalled();
      expect(harness.persist).not.toHaveBeenCalled();
      expect(harness.transaction).not.toHaveBeenCalled();
    },
  );

  it("cancels an owned active run through the FetchRun interface", async () => {
    harness.run.status = "RUNNING";

    await expect(
      cancelFetchRun({ runId: RUN_ID, userId: "server-user" }),
    ).resolves.toEqual({ kind: "cancelled", status: "FAILED" });

    expect(harness.lock).toHaveBeenCalledTimes(1);
    expect(harness.run).toMatchObject({
      status: "FAILED",
      error: FETCH_RUN_CANCELLED_ERROR,
      terminalAt: expect.any(Date),
    });
  });

  it("projects cancellation after durable progress as PARTIAL", async () => {
    harness.run.status = "RUNNING";
    harness.run.commitStartedAt = new Date("2026-07-24T00:05:00.000Z");

    await expect(
      cancelFetchRun({ runId: RUN_ID, userId: "server-user" }),
    ).resolves.toEqual({ kind: "cancelled", status: "PARTIAL" });
    expect(harness.run.status).toBe("PARTIAL");
  });

  it("checks cancellation ownership only after acquiring FRUN", async () => {
    harness.run.status = "RUNNING";

    await expect(
      cancelFetchRun({ runId: RUN_ID, userId: "another-user" }),
    ).resolves.toEqual({ kind: "not_found" });

    expect(harness.operations[0]).toBe("lock");
    expect(harness.runUpdateMany).not.toHaveBeenCalled();
  });

  it("returns the owned status view without leaking persisted query JSON", async () => {
    harness.run.status = "RUNNING";
    harness.run.updatedAt = new Date();
    harness.run.queries = {
      title: "Platform Engineer",
      queries: ["Platform Engineer", "Backend Engineer", "platform engineer"],
      smartExpand: false,
    };

    await expect(
      getFetchRunStatus({ runId: RUN_ID, userId: "server-user" }),
    ).resolves.toMatchObject({
      id: RUN_ID,
      status: "RUNNING",
      queryTitle: "Platform Engineer",
      queryTerms: ["Platform Engineer", "Backend Engineer"],
      smartExpand: false,
    });
  });

  it("recovers a stale owned run through the same locked failure transition", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-07-24T01:00:00.000Z"));
      harness.run.status = "RUNNING";
      harness.run.executionAttemptId = ATTEMPT_ID;
      harness.run.updatedAt = new Date("2026-07-24T00:00:00.000Z");

      await expect(
        getFetchRunStatus({ runId: RUN_ID, userId: "server-user" }),
      ).resolves.toMatchObject({
        status: "FAILED",
        error: "Dispatch timeout: worker did not report status within 30 minutes",
      });
      expect(harness.lock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets progress after a stale status snapshot win recovery", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-07-24T01:00:00.000Z"));
      harness.run.status = "RUNNING";
      harness.run.executionAttemptId = ATTEMPT_ID;
      harness.run.updatedAt = new Date("2026-07-24T00:45:00.000Z");
      harness.statusFindFirst.mockResolvedValueOnce({
        ...harness.run,
        updatedAt: new Date("2026-07-24T00:00:00.000Z"),
      });

      await expect(
        getFetchRunStatus({ runId: RUN_ID, userId: "server-user" }),
      ).resolves.toMatchObject({ status: "RUNNING", error: null });
      expect(harness.runUpdate).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("sweeps stale candidates through the shared recovery implementation", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-07-24T01:00:00.000Z"));
      harness.run.status = "RUNNING";
      harness.run.executionAttemptId = ATTEMPT_ID;
      harness.run.updatedAt = new Date("2026-07-24T00:00:00.000Z");
      harness.staleCandidateIds.push(RUN_ID);

      await expect(sweepStaleFetchRuns()).resolves.toEqual({
        ids: [RUN_ID],
        candidateCount: 1,
        staleAfterMs: 30 * 60 * 1000,
      });
      expect(harness.run.status).toBe("FAILED");
    } finally {
      vi.useRealTimers();
    }
  });
});
