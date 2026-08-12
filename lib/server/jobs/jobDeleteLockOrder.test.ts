import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The delete cascade is the second place two advisory locks meet: it takes the
 * per-user job lock, then a per-application lock for each job it is about to
 * remove. `test/server/jobDeleteService.test.ts` mocks
 * `acquireApplicationMutationLock` away, so neither the order nor the sorted
 * acquisition it relies on was covered anywhere.
 *
 * Both lock modules are real here and every namespace is recorded, so the
 * sequence is observed. Reversing the pair, or dropping the sort, fails.
 */

const store = vi.hoisted(() => ({
  locks: [] as { namespace: number; key: number }[],
  jobRowLocks: [] as string[][],
  transaction: vi.fn(),
  jobFindMany: vi.fn(),
  jobDeleteMany: vi.fn(),
  applicationFindMany: vi.fn(),
  applicationDeleteMany: vi.fn(),
  deletedJobUrlCreateMany: vi.fn(),
  evidenceSnapshotDeleteMany: vi.fn(),
  claimEvidenceFindMany: vi.fn(),
  applicationBatchFindFirst: vi.fn(),
  applicationBatchUpdate: vi.fn(),
  applicationBatchTaskFindMany: vi.fn(),
  applicationBatchTaskFindFirst: vi.fn(),
  applicationBatchTaskGroupBy: vi.fn(),
  enqueue: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: { $transaction: store.transaction },
}));

vi.mock("@/lib/server/artifacts/applicationArtifactLifecycle", () => ({
  enqueueApplicationArtifactRetirements: store.enqueue,
  canonicalizeApplicationArtifactStorageIdentity: (value: string) => {
    const parsed = new URL(value.trim());
    const pathname = decodeURIComponent(parsed.pathname).replace(/^\/+/, "");
    return {
      storeHost: parsed.hostname.toLowerCase(),
      pathname,
      key: `${parsed.hostname.toLowerCase()}/${pathname}`,
    };
  },
}));

vi.mock("@vercel/blob", () => ({ del: vi.fn() }));

import {
  LOCK_NAMESPACES,
  LOCK_ORDER,
  stableInt32,
} from "@/lib/server/db/advisoryLock";
import { batchDeleteJobs } from "@/lib/server/jobs/jobDeleteService";

const USER_ID = "user-1";
const JOB_IDS = ["job-c", "job-a", "job-b"];

function recordingTx() {
  return {
    $executeRaw: async (_s: TemplateStringsArray, ...values: unknown[]) => {
      store.locks.push({
        namespace: Number(values[0]),
        key: Number(values[1]),
      });
      return 1;
    },
    $queryRaw: async (_s: TemplateStringsArray, ...values: unknown[]) => {
      const joined = values[1] as { values?: unknown[] } | undefined;
      store.jobRowLocks.push(
        (joined?.values ?? []).map((value) => String(value)),
      );
      return [];
    },
    job: { findMany: store.jobFindMany, deleteMany: store.jobDeleteMany },
    application: {
      findMany: store.applicationFindMany,
      deleteMany: store.applicationDeleteMany,
    },
    deletedJobUrl: { createMany: store.deletedJobUrlCreateMany },
    evidenceSnapshot: { deleteMany: store.evidenceSnapshotDeleteMany },
    claimEvidence: { findMany: store.claimEvidenceFindMany },
    applicationBatch: {
      findFirst: store.applicationBatchFindFirst,
      update: store.applicationBatchUpdate,
    },
    applicationBatchTask: {
      findMany: store.applicationBatchTaskFindMany,
      findFirst: store.applicationBatchTaskFindFirst,
      groupBy: store.applicationBatchTaskGroupBy,
    },
  };
}

describe("job delete cascade lock order", () => {
  beforeEach(() => {
    store.locks.length = 0;
    store.jobRowLocks.length = 0;
    vi.clearAllMocks();

    store.transaction.mockImplementation(
      async (
        callback: (tx: ReturnType<typeof recordingTx>) => Promise<unknown>,
      ) => callback(recordingTx()),
    );
    store.jobFindMany.mockResolvedValue(
      JOB_IDS.map((id) => ({ id, jobUrl: `https://example.com/${id}` })),
    );
    store.applicationFindMany.mockResolvedValue([]);
    store.claimEvidenceFindMany.mockResolvedValue([]);
    store.jobDeleteMany.mockResolvedValue({ count: JOB_IDS.length });
    store.applicationDeleteMany.mockResolvedValue({ count: 0 });
    store.deletedJobUrlCreateMany.mockResolvedValue({ count: JOB_IDS.length });
    store.evidenceSnapshotDeleteMany.mockResolvedValue({ count: 0 });
    store.applicationBatchFindFirst.mockResolvedValue(null);
    store.applicationBatchUpdate.mockResolvedValue({});
    store.applicationBatchTaskFindMany.mockResolvedValue([]);
    store.applicationBatchTaskFindFirst.mockResolvedValue(null);
    store.applicationBatchTaskGroupBy.mockResolvedValue([]);
    store.enqueue.mockResolvedValue({ artifacts: [] });
  });

  it("takes the job mutation lock before any application lock", async () => {
    await batchDeleteJobs(USER_ID, JOB_IDS);

    const first = store.locks[0];
    expect(first?.namespace).toBe(LOCK_NAMESPACES.jobMutation);
    expect(first?.key).toBe(stableInt32(USER_ID));

    const firstApplication = store.locks.findIndex(
      (lock) => lock.namespace === LOCK_NAMESPACES.applicationMutation,
    );
    expect(firstApplication).toBeGreaterThan(0);
  });

  it("takes application locks in sorted job-id order", async () => {
    // Two overlapping batch deletes that took these in request order would
    // wait on each other's locks in opposite orders and deadlock.
    await batchDeleteJobs(USER_ID, JOB_IDS);

    const applicationKeys = store.locks
      .filter((lock) => lock.namespace === LOCK_NAMESPACES.applicationMutation)
      .map((lock) => lock.key);
    const expected = [...JOB_IDS]
      .sort()
      .map((jobId) => stableInt32(`${USER_ID}:${jobId}`));

    expect(applicationKeys).toEqual(expected);
  });

  it("never steps backwards through the declared global order", async () => {
    await batchDeleteJobs(USER_ID, JOB_IDS);

    const rank = new Map<number, number>(
      LOCK_ORDER.map((name, index) => [LOCK_NAMESPACES[name] as number, index]),
    );
    const ranks = store.locks.map((lock) => rank.get(lock.namespace));
    expect(ranks.every((value) => value !== undefined)).toBe(true);
    for (let index = 1; index < ranks.length; index += 1) {
      expect(ranks[index]!).toBeGreaterThanOrEqual(ranks[index - 1]!);
    }
  });

  it("keeps the job lock keyed on the user, not a job", async () => {
    await batchDeleteJobs(USER_ID, JOB_IDS);

    const jobLocks = store.locks.filter(
      (lock) => lock.namespace === LOCK_NAMESPACES.jobMutation,
    );
    expect(jobLocks).toHaveLength(1);
    expect(jobLocks[0].key).toBe(stableInt32(USER_ID));
  });

});
