import assert from "node:assert/strict";
import test from "node:test";

import { runRunnerLoop } from "./cli.mjs";

test("a single pass drains the application batch once and exits", async () => {
  const events = [];
  const shutdown = new AbortController();

  await runRunnerLoop({
    watch: false,
    signal: shutdown.signal,
    runApplicationBatch: async () => {
      events.push("application");
      return { batchId: null, succeeded: 0, failed: 0, deferred: 0 };
    },
    log: () => undefined,
  });

  assert.deepEqual(events, ["application"]);
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
    wait: async (milliseconds) => {
      waits.push(milliseconds);
      shutdown.abort();
    },
    log: () => undefined,
  });

  assert.deepEqual(waits, [5_000]);
});

test("an aborted signal stops the watch loop without another cycle", async () => {
  let cycles = 0;
  const shutdown = new AbortController();

  await runRunnerLoop({
    watch: true,
    signal: shutdown.signal,
    runApplicationBatch: async () => {
      cycles += 1;
      shutdown.abort();
      return { batchId: null, succeeded: 0, failed: 0, deferred: 0 };
    },
    wait: async () => {
      throw new Error("must not wait after abort");
    },
    log: () => undefined,
  });

  assert.equal(cycles, 1);
});
