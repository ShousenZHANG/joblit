import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = vi.hoisted(() => ({
  job: { findMany: vi.fn() },
  resumeProfile: { findFirst: vi.fn() },
  applicationBatch: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  applicationBatchTask: {
    findMany: vi.fn(),
    createMany: vi.fn(),
    count: vi.fn(),
  },
}));

const jobLock = vi.hoisted(() => vi.fn());
const batchLock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    $transaction: async (fn: (client: typeof tx) => unknown) => fn(tx),
  },
}));
vi.mock("@/lib/server/jobs/jobMutationLock", () => ({
  acquireJobMutationLock: jobLock,
}));
vi.mock("@/lib/server/tailoringRuns/tailoringRunLock", () => ({
  acquireApplicationBatchLock: batchLock,
}));

import { enqueueJobsForTailoring } from "./enqueueJobsForTailoring";

const JOB_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BATCH_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function withProfile() {
  tx.resumeProfile.findFirst.mockResolvedValue({ id: "profile-1" });
}

beforeEach(() => {
  for (const store of Object.values(tx)) {
    for (const fn of Object.values(store)) fn.mockReset();
  }
  jobLock.mockReset();
  batchLock.mockReset();
  tx.applicationBatchTask.findMany.mockResolvedValue([]);
  tx.applicationBatchTask.createMany.mockResolvedValue({ count: 0 });
  tx.applicationBatchTask.count.mockResolvedValue(0);
  tx.applicationBatch.update.mockResolvedValue({});
});

describe("enqueueJobsForTailoring", () => {
  it("appends to the live batch instead of refusing while one is draining", async () => {
    // The old create route answered 409 ACTIVE_BATCH_EXISTS. That made asking
    // for a single Job depend on whether an unrelated run happened to be
    // draining, which is not something the user should have to schedule around.
    withProfile();
    tx.job.findMany.mockResolvedValue([{ id: JOB_A }]);
    tx.applicationBatch.findFirst.mockResolvedValue({ id: BATCH_ID });
    tx.applicationBatchTask.count.mockResolvedValue(7);

    const outcome = await enqueueJobsForTailoring({
      userId: "user-1",
      jobIds: [JOB_A],
    });

    expect(outcome).toMatchObject({
      kind: "enqueued",
      batchId: BATCH_ID,
      totalCount: 7,
      queuedJobIds: [JOB_A],
    });
    expect(tx.applicationBatch.create).not.toHaveBeenCalled();
    expect(tx.applicationBatch.update).toHaveBeenCalledWith({
      where: { id: BATCH_ID },
      data: { totalCount: 7 },
    });
  });

  it("takes the Job lock before the batch lock", async () => {
    // Nothing else in the codebase takes these the other way round, and this
    // is the only site that holds both. Reversing them here would be the first
    // half of a deadlock nobody would reproduce until production.
    withProfile();
    tx.job.findMany.mockResolvedValue([{ id: JOB_A }]);
    tx.applicationBatch.findFirst.mockResolvedValue({ id: BATCH_ID });

    const order: string[] = [];
    jobLock.mockImplementation(async () => void order.push("job"));
    batchLock.mockImplementation(async () => void order.push("batch"));

    await enqueueJobsForTailoring({ userId: "user-1", jobIds: [JOB_A] });
    expect(order[0]).toBe("job");
    expect(order).toContain("batch");
  });

  it("opens a fresh batch when the live one terminalized under the lock", async () => {
    // The status read happens before the batch lock is held. A reconcile can
    // land in between; appending after it would strand a PENDING task that
    // nothing is ever going to claim.
    withProfile();
    tx.job.findMany.mockResolvedValue([{ id: JOB_A }]);
    tx.applicationBatch.findFirst
      // The unlocked read still sees it as active...
      .mockResolvedValueOnce({ id: BATCH_ID })
      // ...and the re-read under the lock finds it gone.
      .mockResolvedValueOnce(null);
    tx.applicationBatch.create.mockResolvedValue({ id: "fresh-batch" });

    const outcome = await enqueueJobsForTailoring({
      userId: "user-1",
      jobIds: [JOB_A],
    });

    expect(outcome).toMatchObject({ kind: "enqueued", batchId: "fresh-batch" });
    expect(tx.applicationBatch.create).toHaveBeenCalledTimes(1);
  });

  it("treats a Job already in the queue as a no-op, not an error", async () => {
    withProfile();
    tx.job.findMany.mockResolvedValue([{ id: JOB_A }, { id: JOB_B }]);
    tx.applicationBatch.findFirst.mockResolvedValue({ id: BATCH_ID });
    tx.applicationBatchTask.findMany.mockResolvedValue([{ jobId: JOB_A }]);

    const outcome = await enqueueJobsForTailoring({
      userId: "user-1",
      jobIds: [JOB_A, JOB_B],
    });

    expect(outcome).toMatchObject({
      kind: "enqueued",
      queuedJobIds: [JOB_B],
      alreadyQueuedJobIds: [JOB_A],
    });
    expect(tx.applicationBatchTask.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ jobId: JOB_B })],
      }),
    );
  });

  it("derives totalCount from a recount rather than incrementing it", async () => {
    // An increment that raced a concurrent enqueue would leave every progress
    // readout counting toward a total the batch never had.
    withProfile();
    tx.job.findMany.mockResolvedValue([{ id: JOB_A }]);
    tx.applicationBatch.findFirst.mockResolvedValue({ id: BATCH_ID });
    tx.applicationBatchTask.count.mockResolvedValue(12);

    await enqueueJobsForTailoring({ userId: "user-1", jobIds: [JOB_A] });

    expect(tx.applicationBatch.update).toHaveBeenCalledWith({
      where: { id: BATCH_ID },
      data: { totalCount: 12 },
    });
  });

  it("reports the post-insert total so the client can seed its progress UI", async () => {
    // Seeding 0 rendered no banner at all — the progress UI needs a total to
    // show a fraction against — so the user pressed Generate and got silence
    // until the next poll landed.
    withProfile();
    tx.job.findMany.mockResolvedValue([{ id: JOB_A }]);
    tx.applicationBatch.findFirst.mockResolvedValue({ id: BATCH_ID });
    tx.applicationBatchTask.count.mockResolvedValue(3);

    const outcome = await enqueueJobsForTailoring({
      userId: "user-1",
      jobIds: [JOB_A],
    });

    expect(outcome).toMatchObject({ kind: "enqueued", totalCount: 3 });
  });

  it("refuses a Job that already has an Application", async () => {
    // A task starts a two-target TailoringRun, so admitting a Job with an
    // existing Application could overwrite a document the user accepted.
    withProfile();
    tx.job.findMany.mockResolvedValue([]);

    const outcome = await enqueueJobsForTailoring({
      userId: "user-1",
      jobIds: [JOB_A],
    });

    expect(outcome).toEqual({
      kind: "none_eligible",
      ineligibleJobIds: [JOB_A],
    });
    expect(tx.applicationBatch.create).not.toHaveBeenCalled();
    expect(tx.applicationBatchTask.createMany).not.toHaveBeenCalled();
  });

  it("scopes eligibility to the session tenant and the AU workspace", async () => {
    // Mocks do not enforce a WHERE clause, so assert the clause itself.
    withProfile();
    tx.job.findMany.mockResolvedValue([]);

    await enqueueJobsForTailoring({ userId: "user-1", jobIds: [JOB_A] });

    expect(tx.job.findMany.mock.calls[0][0].where).toMatchObject({
      userId: "user-1",
      market: "AU",
      status: "NEW",
      applications: { none: { userId: "user-1" } },
    });
  });

  it("stops before touching the queue when there is no master profile", async () => {
    tx.resumeProfile.findFirst.mockResolvedValue(null);

    const outcome = await enqueueJobsForTailoring({
      userId: "user-1",
      jobIds: [JOB_A],
    });

    expect(outcome).toEqual({ kind: "profile_missing" });
    expect(tx.job.findMany).not.toHaveBeenCalled();
  });

  it("collapses a duplicate id in one request", async () => {
    withProfile();
    tx.job.findMany.mockResolvedValue([{ id: JOB_A }]);
    tx.applicationBatch.findFirst.mockResolvedValue({ id: BATCH_ID });

    await enqueueJobsForTailoring({
      userId: "user-1",
      jobIds: [JOB_A, JOB_A, JOB_A],
    });

    expect(tx.job.findMany.mock.calls[0][0].where.id).toEqual({ in: [JOB_A] });
  });
});
