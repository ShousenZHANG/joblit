import { beforeEach, describe, expect, it, vi } from "vitest";

const taskStore = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@/lib/server/prisma", () => ({
  prisma: { applicationBatchTask: taskStore },
}));

import { getJobTailoringStates } from "./jobTailoringState";

const NOW = new Date("2026-08-10T12:00:00.000Z");
const LIVE_LEASE = new Date("2026-08-10T12:10:00.000Z");
const DEAD_LEASE = new Date("2026-08-10T11:50:00.000Z");

/** Newest first, matching the `orderBy: { updatedAt: "desc" }` the query uses. */
function task(overrides: Record<string, unknown>) {
  return {
    jobId: "job-1",
    status: "SUCCEEDED",
    executionLeaseExpiresAt: null,
    batch: { status: "SUCCEEDED" },
    ...overrides,
  };
}

async function resolve(rows: ReturnType<typeof task>[], jobIds = ["job-1"]) {
  taskStore.findMany.mockResolvedValueOnce(rows);
  return getJobTailoringStates({ userId: "user-1", jobIds, now: NOW });
}

describe("getJobTailoringStates", () => {
  beforeEach(() => {
    taskStore.findMany.mockReset();
  });

  it("skips the query entirely for an empty page", async () => {
    const states = await getJobTailoringStates({ userId: "user-1", jobIds: [] });
    expect(states.size).toBe(0);
    expect(taskStore.findMany).not.toHaveBeenCalled();
  });

  it("calls a live claim with an expired lease stalled, not running", async () => {
    // A lease the server issued and then let expire is the difference between
    // "this is being worked on" and "nobody is coming". Reporting it as running
    // is what let a spinner outlive the process behind it.
    const states = await resolve([
      task({
        status: "RUNNING",
        executionLeaseExpiresAt: DEAD_LEASE,
        batch: { status: "RUNNING" },
      }),
    ]);
    expect(states.get("job-1")).toBe("stalled");
  });

  it("keeps a live claim inside its lease running", async () => {
    const states = await resolve([
      task({
        status: "RUNNING",
        executionLeaseExpiresAt: LIVE_LEASE,
        batch: { status: "RUNNING" },
      }),
    ]);
    expect(states.get("job-1")).toBe("running");
  });

  it("forgets a failure once a later attempt settled", async () => {
    // The regression this guards: a Job that failed once and succeeded on
    // retry wore the failure forever, next to the PDF that disproved it.
    const states = await resolve([
      task({ status: "SUCCEEDED" }),
      task({ status: "FAILED", batch: { status: "FAILED" } }),
    ]);
    expect(states.has("job-1")).toBe(false);
  });

  it("reports a failure while it is still the last thing that happened", async () => {
    const states = await resolve([
      task({ status: "FAILED", batch: { status: "FAILED" } }),
      task({ status: "SUCCEEDED" }),
    ]);
    expect(states.get("job-1")).toBe("failed");
  });

  it("lets a fresh retry override an older failure", async () => {
    // Live work is what the user is waiting on. A stale FAILED row must not
    // outrank the queued retry they just asked for.
    const states = await resolve([
      task({ status: "FAILED", batch: { status: "FAILED" } }),
      task({ status: "PENDING", batch: { status: "QUEUED" } }),
    ]);
    expect(states.get("job-1")).toBe("queued");
  });

  it("ignores unfinished tasks whose batch is already terminal", async () => {
    // A cancelled batch leaves PENDING tasks behind. Nothing will ever claim
    // them, so calling them queued promises work that will not happen.
    const states = await resolve([
      task({ status: "PENDING", batch: { status: "CANCELLED" } }),
    ]);
    expect(states.has("job-1")).toBe(false);
  });

  it("ranks a stalled task above a queued sibling on the same Job", async () => {
    const states = await resolve([
      task({ status: "PENDING", batch: { status: "QUEUED" } }),
      task({
        status: "RUNNING",
        executionLeaseExpiresAt: DEAD_LEASE,
        batch: { status: "RUNNING" },
      }),
    ]);
    expect(states.get("job-1")).toBe("stalled");
  });

  it("scopes the query to the session tenant on both the task and its Job", async () => {
    // Mocks do not enforce a WHERE clause, so assert the clause itself: a task
    // row alone cannot prove who owns the Job it points at.
    await resolve([]);
    expect(taskStore.findMany.mock.calls[0][0].where).toMatchObject({
      userId: "user-1",
      job: { userId: "user-1" },
    });
  });
});
