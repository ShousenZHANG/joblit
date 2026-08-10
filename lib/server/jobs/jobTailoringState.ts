import { prisma } from "@/lib/server/prisma";

/**
 * What a Job's tailoring work is doing right now, from the server's own
 * records rather than from whatever the browser happened to observe.
 *
 * The Jobs list previously carried no trace of the batch at all. A user who
 * queued generation, navigated away, and came back saw exactly the row they
 * saw before pressing the button — the only evidence anything had happened
 * was a banner that a reload erased. "Did I already ask for this one?" had no
 * answer, so the honest response was to press the button again.
 *
 * `ready` is deliberately absent here: a finished Application is already
 * carried by `applicationId`/`resumePdfUrl` on the row, and duplicating it
 * would create two sources of truth that could disagree.
 */
export type JobTailoringState =
  | "idle"
  | "queued"
  | "running"
  | "stalled"
  | "failed";

const LIVE_BATCH_STATUSES = ["QUEUED", "RUNNING"] as const;

/**
 * Rank live work by how much the user needs to know about it. A Job can hold
 * tasks from several batches at once, and a stalled one must not be hidden
 * behind a sibling that has yet to start.
 */
const LIVE_PRIORITY: Record<"stalled" | "running" | "queued", number> = {
  stalled: 3,
  running: 2,
  queued: 1,
};

/**
 * Resolve the live tailoring state for a page of Jobs in one query.
 *
 * Jobs with nothing to report are simply absent from the returned map; the
 * caller defaults them to `idle`. Callers must fold the result into any cache
 * validator they compute — a state that changes without changing the ETag is
 * a state the browser will never be told about.
 */
export async function getJobTailoringStates(input: {
  userId: string;
  jobIds: string[];
  now?: Date;
}): Promise<Map<string, JobTailoringState>> {
  const states = new Map<string, JobTailoringState>();
  if (input.jobIds.length === 0) return states;

  const now = input.now ?? new Date();
  const tasks = await prisma.applicationBatchTask.findMany({
    where: {
      userId: input.userId,
      jobId: { in: input.jobIds },
      job: { userId: input.userId },
    },
    select: {
      jobId: true,
      status: true,
      executionLeaseExpiresAt: true,
      batch: { select: { status: true } },
    },
    // Newest first, so the first task seen for a Job is the one that describes
    // where it currently stands.
    orderBy: { updatedAt: "desc" },
    // A page holds a few dozen Jobs and each batch contributes one task per
    // Job, so this is generous. It exists only to bound a pathological retry
    // history; the ordering makes the rows it drops the least relevant ones.
    take: input.jobIds.length * 8,
  });

  const live = new Map<string, "queued" | "running" | "stalled">();
  const latest = new Map<string, JobTailoringState>();

  for (const task of tasks) {
    const batchIsLive = (LIVE_BATCH_STATUSES as readonly string[]).includes(
      task.batch.status,
    );

    if (batchIsLive && (task.status === "PENDING" || task.status === "RUNNING")) {
      const state =
        task.status === "PENDING"
          ? "queued"
          : task.executionLeaseExpiresAt &&
              task.executionLeaseExpiresAt <= now
            ? // Claimed, but the lease the server issued has run out. Calling
              // this "running" is the lie that lets a spinner outlive the work
              // behind it.
              "stalled"
            : "running";
      const current = live.get(task.jobId);
      if (!current || LIVE_PRIORITY[state] > LIVE_PRIORITY[current]) {
        live.set(task.jobId, state);
      }
      continue;
    }

    // First settled task seen for this Job is its most recent one. A failure
    // is only worth reporting while it is still the last thing that happened —
    // otherwise a Job that failed once and succeeded on retry would wear the
    // failure forever, next to the PDF that disproves it.
    if (!latest.has(task.jobId)) {
      latest.set(task.jobId, task.status === "FAILED" ? "failed" : "idle");
    }
  }

  for (const [jobId, state] of latest) {
    if (state !== "idle") states.set(jobId, state);
  }
  // Live work always wins: it is what the user is waiting on right now.
  for (const [jobId, state] of live) states.set(jobId, state);

  return states;
}
