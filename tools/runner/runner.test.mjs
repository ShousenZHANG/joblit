import assert from "node:assert/strict";
import test from "node:test";

import { processActiveBatch } from "./runner.mjs";

/**
 * The Runner is the batch protocol's first unattended worker: what Codex did
 * interactively, it does headless against the local Hermes gateway. These
 * tests drive the orchestration with fake clients — the HTTP shapes are
 * pinned by the client tests, the protocol order by these.
 *
 * One protocol fact these encode: success is implicit. completedTasks only
 * carries FAILED and SKIPPED; a task that imported through manual-generate is
 * settled by that import, and reporting it again would be rejected.
 */

function makeJob(id) {
  return { title: `Role ${id}`, company: "Acme" };
}

function fakeJoblit(script) {
  const calls = { runOnce: [], prompt: [], imports: [] };
  let step = 0;
  return {
    calls,
    client: {
      async activeBatch() {
        return script.activeBatch ?? { batchId: "batch-1", status: "QUEUED" };
      },
      async runOnce(batchId, { completedTasks }) {
        calls.runOnce.push({ batchId, completedTasks });
        const frame = script.steps[step] ?? { tasks: [], batchStatus: "COMPLETED" };
        step += 1;
        return {
          batch: { id: batchId, status: frame.batchStatus ?? "RUNNING" },
          tasks: frame.tasks ?? [],
          execution: { stopReason: frame.stopReason ?? null },
        };
      },
      async prompt(request) {
        calls.prompt.push(request);
        if (script.promptError) throw script.promptError;
        return {
          prompt: {
            systemPrompt: `system for ${request.jobId}`,
            userPrompt: `user for ${request.jobId} ${request.target}`,
          },
          promptMeta: { promptHash: `hash-${request.target}`, ruleSetId: "rules-1" },
          tailoringRun: { handle: `run-${request.jobId}-${request.target}` },
        };
      },
      async importGeneration(request) {
        calls.imports.push(request);
        if (script.importError) throw script.importError;
        return { ok: true };
      },
    },
  };
}

function fakeHermes(script = {}) {
  const calls = { runs: [] };
  return {
    calls,
    client: {
      async generate({ instructions, input, sessionId }) {
        calls.runs.push({ instructions, input, sessionId });
        if (script.failure) throw script.failure;
        const output = `{"generated":"#${calls.runs.length}"}`;
        calls.runs[calls.runs.length - 1].output = output;
        return output;
      },
    },
  };
}

const TASK = {
  taskId: "11111111-1111-4111-8111-111111111111",
  attemptId: "22222222-2222-4222-8222-222222222222",
  jobId: "33333333-3333-4333-8333-333333333333",
  remainingTargets: ["RESUME", "COVER"],
  job: makeJob("a"),
};

test("generates every remaining target and settles the task by importing", async () => {
  const joblit = fakeJoblit({
    steps: [{ tasks: [TASK] }, { tasks: [], batchStatus: "COMPLETED" }],
  });
  const hermes = fakeHermes();

  const summary = await processActiveBatch({
    joblit: joblit.client,
    hermes: hermes.client,
    log: () => {},
  });

  // Both targets went through prompt → Hermes → import, in target order.
  assert.equal(joblit.calls.prompt.length, 2);
  assert.deepEqual(
    joblit.calls.prompt.map((p) => p.target),
    ["resume", "cover"],
  );
  // The prompt request carries the full batch identity the protocol demands.
  assert.deepEqual(joblit.calls.prompt[0], {
    jobId: TASK.jobId,
    target: "resume",
    source: "codex_batch",
    delivery: "FINAL",
    batchId: "batch-1",
    batchTaskId: TASK.taskId,
    batchAttemptId: TASK.attemptId,
  });

  assert.equal(hermes.calls.runs.length, 2);
  assert.equal(hermes.calls.runs[0].instructions, `system for ${TASK.jobId}`);

  // The import forwards Hermes's output, the receipt and the handle exactly
  // as issued.
  assert.equal(joblit.calls.imports.length, 2);
  assert.deepEqual(joblit.calls.imports[0], {
    jobId: TASK.jobId,
    target: "resume",
    source: "codex_batch",
    modelOutput: hermes.calls.runs[0].output,
    promptMeta: { promptHash: "hash-resume", ruleSetId: "rules-1" },
    tailoringRun: { handle: `run-${TASK.jobId}-resume` },
  });

  // Success is implicit: the follow-up claim reports no completions.
  assert.equal(joblit.calls.runOnce.length, 2);
  assert.deepEqual(joblit.calls.runOnce[0].completedTasks, []);
  assert.deepEqual(joblit.calls.runOnce[1].completedTasks, []);

  assert.equal(summary.succeeded, 1);
  assert.equal(summary.failed, 0);
});

test("reports a Hermes failure as FAILED with the reason", async () => {
  const joblit = fakeJoblit({
    steps: [{ tasks: [TASK] }, { tasks: [], batchStatus: "COMPLETED" }],
  });
  const hermes = fakeHermes({ failure: new Error("HERMES_UNREACHABLE") });

  const summary = await processActiveBatch({
    joblit: joblit.client,
    hermes: hermes.client,
    log: () => {},
  });

  assert.equal(joblit.calls.imports.length, 0);
  const reported = joblit.calls.runOnce[1].completedTasks;
  assert.equal(reported.length, 1);
  assert.equal(reported[0].taskId, TASK.taskId);
  assert.equal(reported[0].attemptId, TASK.attemptId);
  assert.equal(reported[0].status, "FAILED");
  assert.match(reported[0].error, /HERMES_UNREACHABLE/);
  assert.equal(summary.failed, 1);
});

test("reports an import rejection as FAILED and keeps going", async () => {
  const joblit = fakeJoblit({
    steps: [{ tasks: [TASK] }, { tasks: [], batchStatus: "COMPLETED" }],
    importError: new Error("APPLICATION_REVIEW_BLOCKED"),
  });
  const hermes = fakeHermes();

  const summary = await processActiveBatch({
    joblit: joblit.client,
    hermes: hermes.client,
    log: () => {},
  });

  const reported = joblit.calls.runOnce[1].completedTasks;
  assert.equal(reported[0].status, "FAILED");
  assert.match(reported[0].error, /APPLICATION_REVIEW_BLOCKED/);
  assert.equal(summary.failed, 1);
});

test("does nothing when no batch is active", async () => {
  const joblit = fakeJoblit({ activeBatch: { batchId: null }, steps: [] });
  const hermes = fakeHermes();

  const summary = await processActiveBatch({
    joblit: joblit.client,
    hermes: hermes.client,
    log: () => {},
  });

  assert.equal(joblit.calls.runOnce.length, 0);
  assert.equal(summary.succeeded + summary.failed, 0);
});

test("stops when the batch reports a terminal status", async () => {
  const joblit = fakeJoblit({
    steps: [
      { tasks: [TASK] },
      { tasks: [], batchStatus: "COMPLETED", stopReason: "done" },
    ],
  });
  const hermes = fakeHermes();

  await processActiveBatch({
    joblit: joblit.client,
    hermes: hermes.client,
    log: () => {},
  });

  // Exactly two round-trips: claim, then settle+observe-completion.
  assert.equal(joblit.calls.runOnce.length, 2);
});
