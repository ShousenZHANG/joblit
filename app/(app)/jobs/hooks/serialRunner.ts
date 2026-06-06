/**
 * Runs async tasks one at a time, in submission order.
 *
 * Why: the single-job delete path defers each commit behind its own undo
 * timer. If a user rapidly deletes many rows, those timers can elapse close
 * together and fire a burst of parallel DELETE requests — which spikes Neon's
 * connection pool and produces intermittent rateLimitExceeded errors (the same
 * failure mode runChunkedBatchDelete avoids by going sequential).
 *
 * A serial runner chains the network calls so at most one is in flight at a
 * time, in the order they were queued. A failing task does NOT break the chain:
 * later tasks still run (each caller handles its own error/rollback).
 */
export type SerialRunner = <T>(task: () => Promise<T>) => Promise<T>;

export function createSerialRunner(): SerialRunner {
  let tail: Promise<unknown> = Promise.resolve();

  return function run<T>(task: () => Promise<T>): Promise<T> {
    // Run `task` after the previous one settles, regardless of its outcome.
    const result = tail.then(task, task);
    // Keep the chain alive but swallow settlement so one rejection can't poison
    // the tail (and so unhandled-rejection warnings don't fire on the chain).
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}
