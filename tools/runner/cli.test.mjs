import assert from "node:assert/strict";
import test from "node:test";

import { runRunnerLoop } from "./cli.mjs";

test("the watch loop prioritizes an explicit application batch before background fit work", async () => {
  const events = [];
  const shutdown = new AbortController();

  await runRunnerLoop({
    watch: false,
    signal: shutdown.signal,
    runApplicationBatch: async () => {
      events.push("application");
      return { batchId: null, succeeded: 0, failed: 0, deferred: 0 };
    },
    runFitQueue: async () => {
      events.push("fit");
      return { scored: 0, failed: 0 };
    },
    log: () => undefined,
  });

  assert.deepEqual(events, ["application", "fit"]);
});

test("idle watch checks for newly queued work again within five seconds", async () => {
  const waits = [];
  const shutdown = new AbortController();

  await runRunnerLoop({
    watch: true,
    signal: shutdown.signal,
    runApplicationBatch: async () => ({
      batchId: null,
      succeeded: 0,
      failed: 0,
      deferred: 0,
    }),
    runFitQueue: async () => ({ scored: 0, failed: 0 }),
    wait: async (milliseconds) => {
      waits.push(milliseconds);
      shutdown.abort();
    },
    log: () => undefined,
  });

  assert.deepEqual(waits, [5_000]);
});

test("watch mode yields after one Fit claim so application work is checked again", async () => {
  const shutdown = new AbortController();
  let fitLimit;

  await runRunnerLoop({
    watch: true,
    signal: shutdown.signal,
    runApplicationBatch: async () => ({
      batchId: null,
      succeeded: 0,
      failed: 0,
      deferred: 0,
    }),
    runFitQueue: async ({ maxBatches }) => {
      fitLimit = maxBatches;
      shutdown.abort();
      return { scored: 1, failed: 0 };
    },
    log: () => undefined,
  });

  assert.equal(fitLimit, 1);
});
