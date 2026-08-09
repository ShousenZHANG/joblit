import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ADR-0008 declares the `FRUN → JOBJ` lock order mandatory, and until now no
 * test executed it. `fetchRunCommit.test.ts` mocks `acquireFetchRunLifecycleLock`
 * away and mocks `jobImportService` wholesale, so the order was asserted
 * nowhere — a reversal would have deadlocked in production against a
 * concurrent cancel, with a green suite.
 *
 * This file leaves both lock modules real and records the namespace each one
 * issues, so the sequence is observed rather than assumed. Only prisma and the
 * job import body are substituted; the substitute takes the real job mutation
 * lock exactly where the real `persistPreparedJobImport` does.
 */

const harness = vi.hoisted(() => ({
  /** Namespaces recorded in the order the real lock modules issue them. */
  locks: [] as number[],
  transaction: vi.fn(),
  ownerFindUnique: vi.fn(),
  runFindUnique: vi.fn(),
  runUpdate: vi.fn(),
  receiptFindUnique: vi.fn(),
  receiptCreate: vi.fn(),
  prepare: vi.fn(),
  persist: vi.fn(),
  reportError: vi.fn(),
  run: {
    userId: "server-user",
    market: "AU",
    status: "RUNNING",
    error: null as string | null,
    importedCount: 0,
    invalidCount: 0,
    discoveredCount: 0,
    expectedBatchCount: null as number | null,
    nextBatchIndex: 0,
    commitStartedAt: null as Date | null,
    terminalAt: null as Date | null,
    executionAttemptId: "11111111-1111-4111-8111-111111111111" as string | null,
    executionLeaseExpiresAt: null as Date | null,
    updatedAt: new Date("2026-07-24T00:00:00.000Z"),
  },
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    $transaction: harness.transaction,
    fetchRun: { findUnique: harness.ownerFindUnique },
  },
}));

// Deliberately NOT mocked: ./fetchRunLifecycleLock and jobMutationLock.
vi.mock("@/lib/server/jobs/jobImportService", async () => {
  const { acquireJobMutationLock } = await import(
    "@/lib/server/jobs/jobMutationLock"
  );
  return {
    prepareJobImportForUser: harness.prepare,
    persistPreparedJobImport: async (
      tx: Parameters<typeof acquireJobMutationLock>[0],
      input: { userId: string },
    ) => {
      // The real implementation takes this lock as its first statement.
      await acquireJobMutationLock(tx, input.userId);
      return harness.persist();
    },
    isJobImportEnrichmentMigrationRace: () => false,
  };
});

vi.mock("@/lib/server/observability/errorReporter", () => ({
  reportError: harness.reportError,
}));

import { LOCK_NAMESPACES, LOCK_ORDER } from "@/lib/server/db/advisoryLock";
import { FETCH_RUN_COMMIT_PROTOCOL, commitFetchRun } from "./fetchRunCommit";

const RUN_ID = "550e8400-e29b-41d4-a716-446655440000";
const ATTEMPT_ID = "11111111-1111-4111-8111-111111111111";

/** Records the namespace of every advisory lock the real modules issue. */
function recordingTx() {
  return {
    $executeRaw: async (_s: TemplateStringsArray, ...values: unknown[]) => {
      harness.locks.push(Number(values[0]));
      return 1;
    },
    fetchRun: {
      findUnique: harness.runFindUnique,
      update: harness.runUpdate,
    },
    fetchRunCommitReceipt: {
      findUnique: harness.receiptFindUnique,
      create: harness.receiptCreate,
    },
  };
}

describe("FetchRun commit lock order (ADR-0008)", () => {
  beforeEach(() => {
    harness.locks.length = 0;
    for (const mock of [
      harness.transaction,
      harness.ownerFindUnique,
      harness.runFindUnique,
      harness.runUpdate,
      harness.receiptFindUnique,
      harness.receiptCreate,
      harness.prepare,
      harness.persist,
      harness.reportError,
    ]) {
      mock.mockReset();
    }

    harness.transaction.mockImplementation(
      async (callback: (tx: ReturnType<typeof recordingTx>) => Promise<unknown>) =>
        callback(recordingTx()),
    );
    harness.ownerFindUnique.mockImplementation(async () => ({
      userId: harness.run.userId,
      market: harness.run.market,
    }));
    harness.runFindUnique.mockImplementation(async () => ({ ...harness.run }));
    harness.runUpdate.mockImplementation(async () => ({ ...harness.run }));
    harness.receiptFindUnique.mockImplementation(async () => null);
    harness.receiptCreate.mockImplementation(async () => ({}));
    harness.prepare.mockImplementation(async () => ({
      prepared: [{ jobUrl: "https://example.com/jobs/1" }],
      invalidCount: 0,
    }));
    harness.persist.mockImplementation(async () => 1);
  });

  function commitCommand() {
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
    };
  }

  it("takes the FetchRun lifecycle lock before the job mutation lock", async () => {
    await commitFetchRun(commitCommand());

    expect(harness.locks).toContain(LOCK_NAMESPACES.fetchRunLifecycle);
    expect(harness.locks).toContain(LOCK_NAMESPACES.jobMutation);
    expect(harness.locks.indexOf(LOCK_NAMESPACES.fetchRunLifecycle)).toBeLessThan(
      harness.locks.indexOf(LOCK_NAMESPACES.jobMutation),
    );
  });

  it("takes the lifecycle lock as the transaction's first statement", async () => {
    await commitFetchRun(commitCommand());
    expect(harness.locks[0]).toBe(LOCK_NAMESPACES.fetchRunLifecycle);
  });

  it("never takes a lock out of the declared global order", async () => {
    await commitFetchRun(commitCommand());

    const rank = new Map<number, number>(
      LOCK_ORDER.map((name, index) => [LOCK_NAMESPACES[name] as number, index]),
    );
    const ranks = harness.locks.map((namespace) => rank.get(namespace));
    expect(ranks.every((value) => value !== undefined)).toBe(true);
    // Non-decreasing: a transaction may repeat a lock, never step backwards.
    for (let index = 1; index < ranks.length; index += 1) {
      expect(ranks[index]!).toBeGreaterThanOrEqual(ranks[index - 1]!);
    }
  });

  it("takes the lifecycle lock on start, before any job work", async () => {
    await commitFetchRun({
      protocol: FETCH_RUN_COMMIT_PROTOCOL,
      command: "start" as const,
      runId: RUN_ID,
      attemptId: ATTEMPT_ID,
    });
    expect(harness.locks).toEqual([LOCK_NAMESPACES.fetchRunLifecycle]);
  });

  it("takes the lifecycle lock on fail, so cancel cannot interleave", async () => {
    await commitFetchRun({
      protocol: FETCH_RUN_COMMIT_PROTOCOL,
      command: "fail" as const,
      runId: RUN_ID,
      attemptId: ATTEMPT_ID,
      error: "source timed out",
    });
    expect(harness.locks).toEqual([LOCK_NAMESPACES.fetchRunLifecycle]);
  });
});
