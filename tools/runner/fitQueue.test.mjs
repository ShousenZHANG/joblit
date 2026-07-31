import assert from "node:assert/strict";
import test from "node:test";

import { processFitQueue } from "./fitQueue.mjs";

/**
 * Fit scanning used to run in the browser, driving Hermes through the
 * extension bridge. The queue itself was always server-side — the database
 * hands out leased batches — so the Runner takes over exactly one step: the
 * model call between `next-batch` and `batch-import`.
 */

const CLAIM = "44444444-4444-4444-8444-444444444444";
const JOB_IDS = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
];

function fakeJoblit(script) {
  const calls = { nextBatch: 0, prompts: [], imports: [], markFailed: [], released: [] };
  let step = 0;
  return {
    calls,
    client: {
      async nextFitBatch() {
        calls.nextBatch += 1;
        const frame = script.batches[step] ?? { jobIds: [], pendingTotal: 0, leased: 0 };
        step += 1;
        return {
          jobIds: frame.jobIds ?? [],
          remaining: frame.remaining ?? 0,
          pendingTotal: frame.pendingTotal ?? 0,
          leased: frame.leased ?? 0,
          retryAfterMs: frame.retryAfterMs ?? null,
          claimToken: frame.jobIds?.length ? CLAIM : null,
        };
      },
      async fitPrompt(request) {
        calls.prompts.push(request);
        if (script.promptError) throw script.promptError;
        return {
          prompt: {
            instructions: "triage system",
            input: `triage ${request.jobIds.length} jobs`,
            sessionId: "session-1",
          },
          promptMeta: { promptHash: "hash-triage" },
        };
      },
      async importFitBatch(request) {
        calls.imports.push(request);
        if (script.importError) throw script.importError;
        return { scored: (script.scored ?? request.jobIds).map((jobId) => ({ jobId })) };
      },
      async markFitFailed(request) {
        calls.markFailed.push(request);
      },
      async releaseFitBatch(request) {
        calls.released.push(request);
      },
    },
  };
}

function fakeHermes(script = {}) {
  const calls = { runs: [] };
  return {
    calls,
    client: {
      async generate(run) {
        calls.runs.push(run);
        if (script.failure) throw script.failure;
        return '[{"jobId":"x","matchScore":80}]';
      },
    },
  };
}

test("scores a claimed batch through Hermes and imports the result", async () => {
  const joblit = fakeJoblit({ batches: [{ jobIds: JOB_IDS, remaining: 0 }, {}] });
  const hermes = fakeHermes();

  const summary = await processFitQueue({
    joblit: joblit.client,
    hermes: hermes.client,
    log: () => {},
  });

  assert.deepEqual(joblit.calls.prompts, [{ jobIds: JOB_IDS }]);
  assert.equal(hermes.calls.runs.length, 1);
  assert.equal(hermes.calls.runs[0].instructions, "triage system");
  assert.equal(hermes.calls.runs[0].sessionId, "joblit:fit:session-1");

  assert.equal(joblit.calls.imports.length, 1);
  assert.deepEqual(joblit.calls.imports[0], {
    jobIds: JOB_IDS,
    claimToken: CLAIM,
    modelOutput: '[{"jobId":"x","matchScore":80}]',
    promptMeta: { promptHash: "hash-triage" },
  });

  assert.equal(summary.scored, 2);
  assert.equal(summary.failed, 0);
  assert.equal(joblit.calls.markFailed.length, 0);
});

test("marks the batch failed when Hermes cannot score it", async () => {
  const joblit = fakeJoblit({ batches: [{ jobIds: JOB_IDS }, {}] });
  const hermes = fakeHermes({ failure: new Error("HERMES_UNREACHABLE") });

  const summary = await processFitQueue({
    joblit: joblit.client,
    hermes: hermes.client,
    log: () => {},
  });

  assert.equal(joblit.calls.imports.length, 0);
  // Dequeued, not left leased — otherwise the pump loops on it forever.
  assert.deepEqual(joblit.calls.markFailed, [{ jobIds: JOB_IDS, claimToken: CLAIM }]);
  assert.equal(summary.failed, 2);
});

test("marks only the jobs the model skipped, not the whole batch", async () => {
  const joblit = fakeJoblit({
    batches: [{ jobIds: JOB_IDS }, {}],
    scored: [JOB_IDS[0]],
  });
  const hermes = fakeHermes();

  const summary = await processFitQueue({
    joblit: joblit.client,
    hermes: hermes.client,
    log: () => {},
  });

  assert.equal(summary.scored, 1);
  assert.equal(summary.failed, 1);
  assert.equal(joblit.calls.markFailed.length, 1);
});

test("waits out a lease held by another scan instead of declaring the queue empty", async () => {
  const joblit = fakeJoblit({
    batches: [
      { jobIds: [], pendingTotal: 3, leased: 3, retryAfterMs: 1 },
      { jobIds: JOB_IDS },
      {},
    ],
  });
  const hermes = fakeHermes();

  const summary = await processFitQueue({
    joblit: joblit.client,
    hermes: hermes.client,
    log: () => {},
    leaseWaitMs: 1,
  });

  assert.equal(joblit.calls.nextBatch, 3);
  assert.equal(summary.scored, 2);
});

test("stops immediately when nothing is pending", async () => {
  const joblit = fakeJoblit({ batches: [{ jobIds: [], pendingTotal: 0, leased: 0 }] });
  const hermes = fakeHermes();

  const summary = await processFitQueue({
    joblit: joblit.client,
    hermes: hermes.client,
    log: () => {},
  });

  assert.equal(joblit.calls.nextBatch, 1);
  assert.equal(hermes.calls.runs.length, 0);
  assert.equal(summary.scored + summary.failed, 0);
});

test("releases the claim when the prompt cannot be built", async () => {
  const joblit = fakeJoblit({
    batches: [{ jobIds: JOB_IDS }, {}],
    promptError: new Error("Create your resume first"),
  });
  const hermes = fakeHermes();

  const summary = await processFitQueue({
    joblit: joblit.client,
    hermes: hermes.client,
    log: () => {},
  });

  // A missing profile is the user's to fix and applies to every batch, so the
  // claim goes back to the queue rather than burning the jobs as failed.
  assert.deepEqual(joblit.calls.released, [{ jobIds: JOB_IDS, claimToken: CLAIM }]);
  assert.equal(joblit.calls.markFailed.length, 0);
  assert.equal(hermes.calls.runs.length, 0);
  assert.equal(summary.stopped, "Create your resume first");
});
