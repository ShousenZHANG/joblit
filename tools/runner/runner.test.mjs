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

const RESUME_RUN_ID = "55555555-5555-4555-8555-555555555555";
const COVER_RUN_ID = "66666666-6666-4666-8666-666666666666";

function fakeJoblit(script) {
  const calls = {
    runOnce: [],
    prompt: [],
    imports: [],
    publications: [],
    releases: [],
    statuses: [],
  };
  let step = 0;
  const tailoringStatuses = [...(script.tailoringStatuses ?? [])];
  return {
    calls,
    client: {
      async activeBatch() {
        return script.activeBatch ?? { batchId: "batch-1", status: "QUEUED" };
      },
      async runOnce(batchId, { completedTasks }) {
        calls.runOnce.push({ batchId, completedTasks });
        const frame = script.steps[step] ?? {
          tasks: [],
          batchStatus: "COMPLETED",
        };
        step += 1;
        return {
          batch: { id: batchId, status: frame.batchStatus ?? "RUNNING" },
          tasks: frame.tasks ?? [],
          execution: {
            stopReason: frame.stopReason ?? null,
            retryAfterMs: frame.retryAfterMs ?? null,
            earliestLeaseExpiresAt: frame.earliestLeaseExpiresAt ?? null,
          },
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
          promptMeta: {
            promptHash:
              request.target === "resume" ? "a".repeat(64) : "b".repeat(64),
            ruleSetId: "rules-1",
          },
          tailoringRun: {
            id: request.target === "resume" ? RESUME_RUN_ID : COVER_RUN_ID,
            attemptId: request.batchAttemptId,
          },
        };
      },
      async tailoringRunStatus(runId, options = {}) {
        calls.statuses.push(runId);
        if (script.tailoringStatusImpl) {
          return script.tailoringStatusImpl(
            runId,
            options,
            calls.statuses.length,
          );
        }
        return (
          tailoringStatuses.shift() ?? {
            run: {
              id: runId,
              status: "RUNNING",
              handle: {
                id: runId,
                attemptId: TASK.attemptId,
              },
            },
          }
        );
      },
      async importGeneration(request) {
        calls.imports.push(request);
        if (script.importErrors?.length) throw script.importErrors.shift();
        if (script.importError) throw script.importError;
        return script.importResult ?? { ok: true };
      },
      async publishGeneration(request) {
        calls.publications.push(request);
        if (script.publicationErrors?.length) {
          throw script.publicationErrors.shift();
        }
        if (script.publicationError) throw script.publicationError;
        return script.publicationResult ?? { ok: true };
      },
      async releaseTask(batchId, request) {
        calls.releases.push({ batchId, ...request });
        if (script.releaseErrors?.length) throw script.releaseErrors.shift();
        if (script.releaseError) throw script.releaseError;
        return { released: true };
      },
    },
  };
}

function fakeHermes(script = {}) {
  const calls = {
    runs: [],
    repairs: [],
    acknowledgements: [],
    discards: [],
    reconciliations: [],
    recoveries: 0,
  };
  return {
    calls,
    client: {
      async generate({ instructions, input, sessionId, signal, operation }) {
        calls.runs.push({ instructions, input, sessionId, signal, operation });
        if (script.generate) {
          return script.generate(
            { instructions, input, sessionId, signal, operation },
            calls,
          );
        }
        if (script.failure) throw script.failure;
        const output = `{"generated":"#${calls.runs.length}"}`;
        calls.runs[calls.runs.length - 1].output = output;
        return output;
      },
      async repair(request) {
        calls.repairs.push(request);
        if (script.repairFailure) throw script.repairFailure;
        return '{"generated":"repaired"}';
      },
      async acknowledge(request) {
        calls.acknowledgements.push(request);
        if (script.acknowledge) {
          return script.acknowledge(request, calls);
        }
        if (script.acknowledgeFailure) throw script.acknowledgeFailure;
      },
      async discard(request) {
        calls.discards.push(request);
        if (script.discard) return script.discard(request, calls);
      },
      async reconcileObsolete(request) {
        calls.reconciliations.push(request);
        if (script.reconcileObsolete) {
          return script.reconcileObsolete(request, calls);
        }
        return { cleared: true };
      },
      async recoverableOperations() {
        calls.recoveries += 1;
        return script.recoverableOperations ?? [];
      },
    },
  };
}

const TASK = {
  taskId: "11111111-1111-4111-8111-111111111111",
  attemptId: "22222222-2222-4222-8222-222222222222",
  issueKey: "44444444-4444-4444-8444-444444444444",
  protocolVersion: 1,
  jobId: "33333333-3333-4333-8333-333333333333",
  remainingTargets: ["RESUME", "COVER"],
  job: makeJob("a"),
};

test("persists protocol-v2 output before publishing its PDF", async () => {
  const task = {
    ...TASK,
    protocolVersion: 2,
    delivery: "DRAFT",
    remainingTargets: ["RESUME"],
    remainingPublicationTargets: [],
  };
  const joblit = fakeJoblit({
    steps: [{ tasks: [task] }, { tasks: [], batchStatus: "COMPLETED" }],
    importResult: {
      applicationId: "77777777-7777-4777-8777-777777777777",
      aiContentHash: "draft-content-hash",
    },
  });
  const hermes = fakeHermes();

  const summary = await processActiveBatch({
    joblit: joblit.client,
    hermes: hermes.client,
    log: () => {},
  });

  assert.equal(hermes.calls.runs.length, 1);
  assert.equal(joblit.calls.imports.length, 1);
  assert.equal(joblit.calls.publications.length, 1);
  assert.equal(joblit.calls.prompt[0].delivery, "DRAFT");
  assert.deepEqual(joblit.calls.publications[0], {
    applicationId: "77777777-7777-4777-8777-777777777777",
    expectedHash: "draft-content-hash",
    runId: RESUME_RUN_ID,
    attemptId: TASK.attemptId,
    target: "resume",
    batchAttemptId: TASK.attemptId,
  });
  assert.equal(summary.succeeded, 1);
});

test("recovers a durable protocol-v2 draft by publishing without calling Hermes again", async () => {
  const task = {
    ...TASK,
    protocolVersion: 2,
    delivery: "DRAFT",
    remainingTargets: [],
    remainingPublicationTargets: ["COVER"],
    applicationId: "77777777-7777-4777-8777-777777777777",
    applicationAiContentHash: "durable-content-hash",
    tailoringRun: {
      id: COVER_RUN_ID,
      attemptId: TASK.attemptId,
    },
  };
  const joblit = fakeJoblit({
    steps: [{ tasks: [task] }, { tasks: [], batchStatus: "COMPLETED" }],
  });
  const hermes = fakeHermes();

  const summary = await processActiveBatch({
    joblit: joblit.client,
    hermes: hermes.client,
    log: () => {},
  });

  assert.equal(joblit.calls.prompt.length, 0);
  assert.equal(hermes.calls.runs.length, 0);
  assert.equal(joblit.calls.imports.length, 0);
  assert.deepEqual(joblit.calls.publications, [
    {
      applicationId: "77777777-7777-4777-8777-777777777777",
      expectedHash: "durable-content-hash",
      runId: COVER_RUN_ID,
      attemptId: TASK.attemptId,
      target: "cover",
      batchAttemptId: TASK.attemptId,
    },
  ]);
  assert.equal(summary.succeeded, 1);
});

test("replays an ambiguous publication exactly without regenerating Codex output", async () => {
  const unknown = () =>
    Object.assign(new Error("connection reset after publication"), {
      code: "JOBLIT_TRANSPORT_ERROR",
      phase: "publication",
      status: 504,
      requestId: "req-publication-timeout",
      elapsedMs: 12_345,
    });
  const task = {
    ...TASK,
    protocolVersion: 2,
    delivery: "DRAFT",
    remainingTargets: [],
    remainingPublicationTargets: ["COVER"],
    applicationId: "77777777-7777-4777-8777-777777777777",
    applicationAiContentHash: "durable-content-hash",
    tailoringRun: {
      id: COVER_RUN_ID,
      attemptId: TASK.attemptId,
    },
  };
  const joblit = fakeJoblit({
    steps: [{ tasks: [task] }],
    publicationErrors: [unknown(), unknown(), unknown()],
  });
  const hermes = fakeHermes();
  const logs = [];

  const summary = await processActiveBatch({
    joblit: joblit.client,
    hermes: hermes.client,
    settlementRetryMs: 1,
    log: (message) => logs.push(message),
  });

  assert.equal(joblit.calls.publications.length, 3);
  assert.deepEqual(joblit.calls.publications[1], joblit.calls.publications[0]);
  assert.deepEqual(joblit.calls.publications[2], joblit.calls.publications[0]);
  assert.equal(joblit.calls.prompt.length, 0);
  assert.equal(hermes.calls.runs.length, 0);
  assert.equal(joblit.calls.imports.length, 0);
  assert.equal(joblit.calls.runOnce.length, 1);
  assert.deepEqual(joblit.calls.releases, [
    {
      batchId: "batch-1",
      taskId: TASK.taskId,
      attemptId: TASK.attemptId,
      reason: "PUBLICATION_SETTLEMENT_UNKNOWN",
    },
  ]);
  assert.equal(summary.succeeded, 0);
  assert.equal(summary.failed, 0);
  assert.equal(summary.deferred, 1);
  assert.match(
    logs.join("\n"),
    /phase=publication status=504 code=PUBLICATION_SETTLEMENT_UNKNOWN requestId=req-publication-timeout elapsedMs=12345/,
  );
});

test("defers a publication fenced by a newer attempt without reporting FAILED", async () => {
  const task = {
    ...TASK,
    protocolVersion: 2,
    delivery: "DRAFT",
    remainingTargets: [],
    remainingPublicationTargets: ["COVER"],
    applicationId: "77777777-7777-4777-8777-777777777777",
    applicationAiContentHash: "durable-content-hash",
    tailoringRun: { id: COVER_RUN_ID, attemptId: TASK.attemptId },
  };
  const joblit = fakeJoblit({
    steps: [{ tasks: [task] }],
    publicationError: Object.assign(
      new Error("The tailoring attempt has been superseded"),
      { code: "ATTEMPT_STALE", status: 409 },
    ),
  });

  const summary = await processActiveBatch({
    joblit: joblit.client,
    hermes: fakeHermes().client,
    log: () => {},
  });

  assert.equal(summary.failed, 0);
  assert.equal(summary.deferred, 1);
  assert.equal(joblit.calls.runOnce.length, 1);
  assert.deepEqual(joblit.calls.runOnce[0].completedTasks, []);
  assert.deepEqual(joblit.calls.releases, []);
});

test("stops a publication for an already terminal run without reporting FAILED", async () => {
  const task = {
    ...TASK,
    protocolVersion: 2,
    delivery: "DRAFT",
    remainingTargets: [],
    remainingPublicationTargets: ["COVER"],
    applicationId: "77777777-7777-4777-8777-777777777777",
    applicationAiContentHash: "durable-content-hash",
    tailoringRun: { id: COVER_RUN_ID, attemptId: TASK.attemptId },
  };
  const joblit = fakeJoblit({
    steps: [{ tasks: [task] }, { tasks: [], batchStatus: "COMPLETED" }],
    publicationError: Object.assign(
      new Error("The tailoring run is already terminal"),
      { code: "RUN_ALREADY_TERMINAL", status: 409 },
    ),
  });

  const summary = await processActiveBatch({
    joblit: joblit.client,
    hermes: fakeHermes().client,
    log: () => {},
  });

  assert.equal(summary.succeeded, 0);
  assert.equal(summary.failed, 0);
  assert.equal(summary.deferred, 0);
  assert.equal(joblit.calls.runOnce.length, 2);
  assert.deepEqual(joblit.calls.runOnce[1].completedTasks, []);
  assert.deepEqual(joblit.calls.releases, []);
});

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
    protocolVersion: TASK.protocolVersion,
    issueKey: TASK.issueKey,
    batchId: "batch-1",
    batchTaskId: TASK.taskId,
    batchAttemptId: TASK.attemptId,
  });

  assert.equal(hermes.calls.runs.length, 2);
  assert.equal(hermes.calls.runs[0].instructions, `system for ${TASK.jobId}`);
  assert.deepEqual(
    hermes.calls.runs.map((run) => run.sessionId),
    [`joblit:${TASK.taskId}:resume`, `joblit:${TASK.taskId}:cover`],
  );

  // The import forwards Hermes's output, the receipt and the handle exactly
  // as issued.
  assert.equal(joblit.calls.imports.length, 2);
  assert.deepEqual(joblit.calls.imports[0], {
    jobId: TASK.jobId,
    target: "resume",
    source: "codex_batch",
    modelOutput: hermes.calls.runs[0].output,
    promptMeta: { promptHash: "a".repeat(64), ruleSetId: "rules-1" },
    tailoringRun: {
      id: RESUME_RUN_ID,
      attemptId: TASK.attemptId,
    },
  });

  // Success is implicit: the follow-up claim reports no completions.
  assert.equal(joblit.calls.runOnce.length, 2);
  assert.deepEqual(joblit.calls.runOnce[0].completedTasks, []);
  assert.deepEqual(joblit.calls.runOnce[1].completedTasks, []);
  assert.deepEqual(hermes.calls.acknowledgements, [
    { sessionId: `joblit:${TASK.taskId}:resume` },
    { sessionId: `joblit:${TASK.taskId}:cover` },
  ]);

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

test("defers an unknown Hermes start without reporting the task FAILED", async () => {
  const unknown = Object.assign(new Error("start response lost"), {
    code: "RUN_START_UNKNOWN",
  });
  const joblit = fakeJoblit({
    steps: [{ tasks: [{ ...TASK, remainingTargets: ["RESUME"] }] }],
  });
  const hermes = fakeHermes({ failure: unknown });

  const summary = await processActiveBatch({
    joblit: joblit.client,
    hermes: hermes.client,
    log: () => {},
  });

  assert.equal(joblit.calls.runOnce.length, 1);
  assert.deepEqual(joblit.calls.runOnce[0].completedTasks, []);
  assert.equal(summary.failed, 0);
  assert.equal(summary.deferred, 1);
});

test("defers retryable Hermes HTTP failures instead of reporting task failure", async () => {
  for (const status of [408, 425, 429, 503]) {
    const joblit = fakeJoblit({
      steps: [{ tasks: [{ ...TASK, remainingTargets: ["RESUME"] }] }],
    });
    const hermes = fakeHermes({
      failure: Object.assign(new Error(`Hermes HTTP ${status}`), {
        code: "HERMES_HTTP_ERROR",
        status,
      }),
    });

    const summary = await processActiveBatch({
      joblit: joblit.client,
      hermes: hermes.client,
      log: () => {},
    });

    assert.equal(joblit.calls.runOnce.length, 1, `status ${status}`);
    assert.deepEqual(
      joblit.calls.runOnce[0].completedTasks,
      [],
      `status ${status}`,
    );
    assert.equal(summary.failed, 0, `status ${status}`);
    assert.equal(summary.deferred, 1, `status ${status}`);
  }
});

test("stops on an authoritative Hermes cancellation without reporting FAILED", async () => {
  const cancelled = Object.assign(new Error("Hermes run cancelled"), {
    code: "RUN_CANCELLED",
  });
  const joblit = fakeJoblit({
    steps: [
      { tasks: [{ ...TASK, remainingTargets: ["RESUME"] }] },
      { tasks: [], batchStatus: "COMPLETED" },
    ],
  });
  const hermes = fakeHermes({ failure: cancelled });

  const summary = await processActiveBatch({
    joblit: joblit.client,
    hermes: hermes.client,
    log: () => {},
  });

  assert.equal(joblit.calls.runOnce.length, 1);
  assert.deepEqual(joblit.calls.runOnce[0].completedTasks, []);
  assert.equal(summary.failed, 0);
  assert.equal(summary.deferred, 0);
});

test("fails closed before prompt issuance for an unsupported protocol version", async () => {
  const joblit = fakeJoblit({
    steps: [
      { tasks: [{ ...TASK, protocolVersion: 3 }] },
      { tasks: [], batchStatus: "COMPLETED" },
    ],
  });
  const hermes = fakeHermes();

  await processActiveBatch({
    joblit: joblit.client,
    hermes: hermes.client,
    log: () => {},
  });

  assert.equal(joblit.calls.prompt.length, 0);
  assert.equal(hermes.calls.runs.length, 0);
  assert.match(
    joblit.calls.runOnce[1].completedTasks[0].error,
    /Unsupported Agent execution protocol 3/,
  );
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

test("repairs one invalid model output in the same session before importing again", async () => {
  const invalidOutput = Object.assign(
    new Error("AI output is not valid JSON"),
    {
      code: "INVALID_AI_RESULT",
    },
  );
  const joblit = fakeJoblit({
    steps: [
      { tasks: [{ ...TASK, remainingTargets: ["RESUME"] }] },
      { tasks: [], batchStatus: "COMPLETED" },
    ],
    importErrors: [invalidOutput],
  });
  const hermes = fakeHermes();

  const summary = await processActiveBatch({
    joblit: joblit.client,
    hermes: hermes.client,
    log: () => {},
  });

  assert.equal(hermes.calls.repairs.length, 1);
  assert.equal(
    hermes.calls.repairs[0].sessionId,
    `joblit:${TASK.taskId}:resume`,
  );
  assert.match(hermes.calls.repairs[0].feedback, /AI output is not valid JSON/);
  assert.equal(joblit.calls.imports.length, 2);
  assert.equal(joblit.calls.imports[1].modelOutput, '{"generated":"repaired"}');
  assert.deepEqual(hermes.calls.acknowledgements, [
    { sessionId: `joblit:${TASK.taskId}:resume` },
  ]);
  assert.equal(summary.succeeded, 1);
  assert.equal(summary.failed, 0);
});

test("replays the exact import after an unknown settlement outcome", async () => {
  const timeout = Object.assign(new Error("request timed out"), {
    code: "JOBLIT_REQUEST_TIMEOUT",
  });
  const joblit = fakeJoblit({
    steps: [
      { tasks: [{ ...TASK, remainingTargets: ["RESUME"] }] },
      { tasks: [], batchStatus: "COMPLETED" },
    ],
    importErrors: [timeout],
  });
  const hermes = fakeHermes();

  const summary = await processActiveBatch({
    joblit: joblit.client,
    hermes: hermes.client,
    settlementRetryMs: 1,
    log: () => {},
  });

  assert.equal(joblit.calls.imports.length, 2);
  assert.deepEqual(joblit.calls.imports[1], joblit.calls.imports[0]);
  assert.equal(hermes.calls.repairs.length, 0);
  assert.deepEqual(joblit.calls.runOnce[1].completedTasks, []);
  assert.equal(summary.succeeded, 1);
  assert.equal(summary.failed, 0);
  assert.equal(summary.deferred, 0);
});

test("defers an import whose settlement stays unknown instead of reporting FAILED", async () => {
  const unknown = () =>
    Object.assign(new Error("connection reset after upload"), {
      code: "JOBLIT_TRANSPORT_ERROR",
    });
  const joblit = fakeJoblit({
    steps: [{ tasks: [{ ...TASK, remainingTargets: ["RESUME"] }] }],
    importErrors: [unknown(), unknown(), unknown()],
  });
  const hermes = fakeHermes();

  const summary = await processActiveBatch({
    joblit: joblit.client,
    hermes: hermes.client,
    settlementRetryMs: 1,
    log: () => {},
  });

  assert.equal(joblit.calls.imports.length, 3);
  assert.equal(joblit.calls.runOnce.length, 1);
  assert.deepEqual(hermes.calls.acknowledgements, []);
  assert.equal(summary.succeeded, 0);
  assert.equal(summary.failed, 0);
  assert.equal(summary.deferred, 1);
  // Giving the lease back is the whole point. Publication released and import
  // did not, so one deferred import pinned the claim and every later pass
  // reported "another task lease is active" until the lease aged out.
  assert.deepEqual(joblit.calls.releases, [
    {
      batchId: "batch-1",
      taskId: TASK.taskId,
      attemptId: TASK.attemptId,
      reason: "IMPORT_SETTLEMENT_UNKNOWN",
    },
  ]);
});

test("keeps the server's own error code visible on a deferred import", async () => {
  // The wrapper overwrites `code` with the Runner's verdict, so without this
  // the only thing a log ever showed was IMPORT_SETTLEMENT_UNKNOWN — never
  // what the server actually said, which is what made a deterministic 409
  // masquerading as a 500 take days to find.
  const serverRejection = () =>
    Object.assign(new Error("Could not save the draft"), {
      code: "APPLICATION_PERSIST_FAILED",
      status: 500,
      requestId: "req-abc",
    });
  const joblit = fakeJoblit({
    steps: [{ tasks: [{ ...TASK, remainingTargets: ["RESUME"] }] }],
    importErrors: [serverRejection(), serverRejection(), serverRejection()],
  });
  const hermes = fakeHermes();
  const logs = [];

  const summary = await processActiveBatch({
    joblit: joblit.client,
    hermes: hermes.client,
    settlementRetryMs: 1,
    log: (message) => logs.push(message),
  });

  assert.equal(summary.deferred, 1);
  const output = logs.join(" ");
  assert.match(output, /upstreamCode=APPLICATION_PERSIST_FAILED/);
  assert.match(output, /requestId=req-abc/);
});

test("treats local acknowledgement cleanup as non-authoritative", async () => {
  const joblit = fakeJoblit({
    steps: [{ tasks: [TASK] }, { tasks: [], batchStatus: "COMPLETED" }],
  });
  const resumeSession = `joblit:${TASK.taskId}:resume`;
  const hermes = fakeHermes({
    acknowledge(request) {
      if (request.sessionId === resumeSession) {
        throw new Error("state file is temporarily locked");
      }
    },
  });

  const summary = await processActiveBatch({
    joblit: joblit.client,
    hermes: hermes.client,
    settlementRetryMs: 1,
    log: () => {},
  });

  assert.deepEqual(
    joblit.calls.imports.map((request) => request.target),
    ["resume", "cover"],
  );
  assert.equal(summary.succeeded, 1);
  assert.equal(summary.failed, 0);
  assert.deepEqual(joblit.calls.runOnce[1].completedTasks, []);
});

test("reconciles an imported result after acknowledgement crashed without repeating Hermes or import", async () => {
  const operation = {
    tailoringRunId: RESUME_RUN_ID,
    attemptId: TASK.attemptId,
    target: "resume",
    promptHash: "a".repeat(64),
  };
  let pending = null;
  let acknowledgementCrashes = true;
  const hermes = fakeHermes({
    generate(request) {
      pending = {
        sessionId: request.sessionId,
        phase: "completed",
        operation: request.operation,
      };
      return '{"generated":"once"}';
    },
    acknowledge({ sessionId }) {
      if (acknowledgementCrashes) throw new Error("simulated process crash");
      assert.equal(sessionId, pending.sessionId);
      pending = null;
    },
  });
  hermes.client.recoverableOperations = async () => (pending ? [pending] : []);

  const firstJoblit = fakeJoblit({
    steps: [
      { tasks: [{ ...TASK, remainingTargets: ["RESUME"] }] },
      { tasks: [], batchStatus: "COMPLETED" },
    ],
  });
  const firstSummary = await processActiveBatch({
    joblit: firstJoblit.client,
    hermes: hermes.client,
    settlementRetryMs: 1,
    log: () => {},
  });

  assert.equal(firstSummary.succeeded, 1);
  assert.deepEqual(pending?.operation, operation);
  assert.equal(firstJoblit.calls.imports.length, 1);
  assert.equal(hermes.calls.runs.length, 1);

  acknowledgementCrashes = false;
  const restartedJoblit = fakeJoblit({
    activeBatch: { batchId: null },
    steps: [],
    tailoringStatuses: [
      {
        run: {
          id: RESUME_RUN_ID,
          status: "RUNNING",
          acceptedTargetMask: 1,
          handle: { id: RESUME_RUN_ID, attemptId: TASK.attemptId },
        },
      },
    ],
  });
  await processActiveBatch({
    joblit: restartedJoblit.client,
    hermes: hermes.client,
    log: () => {},
  });

  assert.equal(pending, null);
  assert.deepEqual(restartedJoblit.calls.statuses, [RESUME_RUN_ID]);
  assert.equal(restartedJoblit.calls.imports.length, 0);
  assert.equal(hermes.calls.runs.length, 1);
});

test("preserves accepted recovery state when local cleanup is still unavailable", async () => {
  const sessionId = `joblit:${TASK.taskId}:resume`;
  const logs = [];
  const hermes = fakeHermes({
    acknowledgeFailure: new Error("state file is still locked"),
    recoverableOperations: [
      {
        sessionId,
        phase: "completed",
        operation: {
          tailoringRunId: RESUME_RUN_ID,
          attemptId: TASK.attemptId,
          target: "resume",
          promptHash: "a".repeat(64),
        },
      },
    ],
  });
  const joblit = fakeJoblit({
    activeBatch: { batchId: null },
    tailoringStatuses: [
      {
        run: {
          id: RESUME_RUN_ID,
          status: "RUNNING",
          acceptedTargetMask: 1,
          handle: { id: RESUME_RUN_ID, attemptId: TASK.attemptId },
        },
      },
    ],
  });

  await processActiveBatch({
    joblit: joblit.client,
    hermes: hermes.client,
    settlementRetryMs: 1,
    log: (message) => logs.push(message),
  });

  assert.equal(hermes.calls.acknowledgements.length, 3);
  assert.match(logs.join("\n"), /cleanup deferred/);
  assert.doesNotMatch(logs.join("\n"), /import already accepted/);
  assert.deepEqual(hermes.calls.discards, []);
});

test("preserves a recoverable result while its exact TailoringRun attempt is still running", async () => {
  const sessionId = `joblit:${TASK.taskId}:resume`;
  const hermes = fakeHermes({
    recoverableOperations: [
      {
        sessionId,
        phase: "completed",
        operation: {
          tailoringRunId: RESUME_RUN_ID,
          attemptId: TASK.attemptId,
          target: "resume",
          promptHash: "a".repeat(64),
        },
      },
    ],
  });
  const joblit = fakeJoblit({
    activeBatch: { batchId: null },
    steps: [],
    tailoringStatuses: [
      {
        run: {
          id: RESUME_RUN_ID,
          status: "RUNNING",
          acceptedTargetMask: 0,
          handle: { id: RESUME_RUN_ID, attemptId: TASK.attemptId },
        },
      },
    ],
  });

  await processActiveBatch({
    joblit: joblit.client,
    hermes: hermes.client,
    log: () => {},
  });

  assert.deepEqual(hermes.calls.acknowledgements, []);
  assert.deepEqual(hermes.calls.discards, []);
  assert.deepEqual(joblit.calls.statuses, [RESUME_RUN_ID]);
});

test("retires starting and running Hermes state after Joblit proves the import was accepted", async () => {
  for (const phase of ["starting", "running"]) {
    const sessionId = `joblit:${TASK.taskId}:resume`;
    const hermes = fakeHermes({
      recoverableOperations: [
        {
          sessionId,
          phase,
          operation: {
            tailoringRunId: RESUME_RUN_ID,
            attemptId: TASK.attemptId,
            target: "resume",
            promptHash: "a".repeat(64),
          },
        },
      ],
    });
    const joblit = fakeJoblit({
      activeBatch: { batchId: null },
      tailoringStatuses: [
        {
          run: {
            id: RESUME_RUN_ID,
            status: "RUNNING",
            acceptedTargetMask: 1,
            handle: { id: RESUME_RUN_ID, attemptId: TASK.attemptId },
          },
        },
      ],
    });

    await processActiveBatch({
      joblit: joblit.client,
      hermes: hermes.client,
      log: () => {},
    });

    assert.deepEqual(
      hermes.calls.reconciliations,
      [{ sessionId, signal: undefined }],
      phase,
    );
    assert.deepEqual(hermes.calls.acknowledgements, [], phase);
    assert.deepEqual(hermes.calls.discards, [], phase);
  }
});

test("retires a live Hermes run after its TailoringRun becomes terminal", async () => {
  const sessionId = `joblit:${TASK.taskId}:cover`;
  const hermes = fakeHermes({
    recoverableOperations: [
      {
        sessionId,
        phase: "running",
        operation: {
          tailoringRunId: COVER_RUN_ID,
          attemptId: TASK.attemptId,
          target: "cover",
          promptHash: "b".repeat(64),
        },
      },
    ],
  });
  const joblit = fakeJoblit({
    activeBatch: { batchId: null },
    tailoringStatuses: [
      {
        run: {
          id: COVER_RUN_ID,
          status: "FAILED",
          acceptedTargetMask: 0,
          handle: null,
        },
      },
    ],
  });

  await processActiveBatch({
    joblit: joblit.client,
    hermes: hermes.client,
    log: () => {},
  });

  assert.deepEqual(hermes.calls.reconciliations, [
    { sessionId, signal: undefined },
  ]);
  assert.deepEqual(hermes.calls.discards, []);
});

test("fails closed and preserves recovery state when the TailoringRun attempt changed", async () => {
  const sessionId = `joblit:${TASK.taskId}:resume`;
  const warnings = [];
  const hermes = fakeHermes({
    recoverableOperations: [
      {
        sessionId,
        phase: "repairing",
        operation: {
          tailoringRunId: RESUME_RUN_ID,
          attemptId: TASK.attemptId,
          target: "resume",
          promptHash: "a".repeat(64),
        },
      },
    ],
  });
  const joblit = fakeJoblit({
    activeBatch: { batchId: null },
    steps: [],
    tailoringStatuses: [
      {
        run: {
          id: RESUME_RUN_ID,
          status: "RUNNING",
          acceptedTargetMask: 0,
          handle: {
            id: RESUME_RUN_ID,
            attemptId: "77777777-7777-4777-8777-777777777777",
          },
        },
      },
    ],
  });

  await processActiveBatch({
    joblit: joblit.client,
    hermes: hermes.client,
    log: (message) => warnings.push(message),
  });

  assert.deepEqual(hermes.calls.acknowledgements, []);
  assert.deepEqual(hermes.calls.discards, []);
  assert.match(warnings.join("\n"), /another execution attempt/);
});

test("discards a recoverable result when its TailoringRun ended without accepting the target", async () => {
  const sessionId = `joblit:${TASK.taskId}:cover`;
  const hermes = fakeHermes({
    recoverableOperations: [
      {
        sessionId,
        phase: "completed",
        operation: {
          tailoringRunId: COVER_RUN_ID,
          attemptId: TASK.attemptId,
          target: "cover",
          promptHash: "b".repeat(64),
        },
      },
    ],
  });
  const joblit = fakeJoblit({
    activeBatch: { batchId: null },
    steps: [],
    tailoringStatuses: [
      {
        run: {
          id: COVER_RUN_ID,
          status: "FAILED",
          acceptedTargetMask: 0,
          handle: null,
        },
      },
    ],
  });

  await processActiveBatch({
    joblit: joblit.client,
    hermes: hermes.client,
    log: () => {},
  });

  assert.deepEqual(hermes.calls.acknowledgements, []);
  assert.deepEqual(hermes.calls.discards, [{ sessionId }]);
});

test("propagates caller cancellation through the controlled Hermes signal", async () => {
  const controller = new AbortController();
  const joblit = fakeJoblit({
    steps: [
      { tasks: [{ ...TASK, remainingTargets: ["RESUME"] }] },
      { tasks: [], batchStatus: "COMPLETED" },
    ],
  });
  const hermes = fakeHermes();

  await processActiveBatch({
    joblit: joblit.client,
    hermes: hermes.client,
    signal: controller.signal,
    log: () => {},
  });

  const controlledSignal = hermes.calls.runs[0].signal;
  assert.notEqual(controlledSignal, controller.signal);
  assert.equal(controlledSignal.aborted, false);

  controller.abort();

  assert.equal(controlledSignal.aborted, true);
});

test("honours a server-side TailoringRun cancellation before starting Hermes", async () => {
  const joblit = fakeJoblit({
    steps: [
      { tasks: [{ ...TASK, remainingTargets: ["RESUME"] }] },
      { tasks: [], batchStatus: "CANCELLED" },
    ],
    tailoringStatuses: [
      {
        run: {
          id: RESUME_RUN_ID,
          status: "CANCELLED",
          errorCode: "TAILORING_CANCELLED",
        },
      },
    ],
  });
  const hermes = fakeHermes();

  const summary = await processActiveBatch({
    joblit: joblit.client,
    hermes: hermes.client,
    cancelPollMs: 1,
    log: () => {},
  });

  assert.deepEqual(joblit.calls.statuses, [RESUME_RUN_ID]);
  assert.equal(hermes.calls.runs.length, 0);
  assert.equal(joblit.calls.runOnce.length, 1);
  assert.equal(summary.failed, 0);
});

test("defers a superseded TailoringRun attempt without reporting task failure", async () => {
  const joblit = fakeJoblit({
    steps: [{ tasks: [{ ...TASK, remainingTargets: ["RESUME"] }] }],
    tailoringStatuses: [
      {
        run: {
          id: RESUME_RUN_ID,
          status: "RUNNING",
          handle: {
            id: RESUME_RUN_ID,
            attemptId: "77777777-7777-4777-8777-777777777777",
          },
        },
      },
    ],
  });
  const hermes = fakeHermes();

  const summary = await processActiveBatch({
    joblit: joblit.client,
    hermes: hermes.client,
    log: () => {},
  });

  assert.equal(hermes.calls.runs.length, 0);
  assert.equal(joblit.calls.runOnce.length, 1);
  assert.equal(summary.failed, 0);
  assert.equal(summary.deferred, 1);
});

test("aborts an in-flight TailoringRun status poll after Hermes settles", async () => {
  let signalMonitorStarted;
  const monitorStarted = new Promise((resolve) => {
    signalMonitorStarted = resolve;
  });
  const joblit = fakeJoblit({
    steps: [
      { tasks: [{ ...TASK, remainingTargets: ["RESUME"] }] },
      { tasks: [], batchStatus: "COMPLETED" },
    ],
    tailoringStatusImpl(runId, { signal }, callNumber) {
      if (callNumber === 1) {
        return {
          run: {
            id: runId,
            status: "RUNNING",
            handle: { id: runId, attemptId: TASK.attemptId },
          },
        };
      }
      return new Promise((_resolve, reject) => {
        signalMonitorStarted();
        signal.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true },
        );
      });
    },
  });
  const hermes = fakeHermes({
    async generate() {
      await monitorStarted;
      return '{"generated":"done"}';
    },
  });

  const summary = await processActiveBatch({
    joblit: joblit.client,
    hermes: hermes.client,
    cancelPollMs: 1,
    log: () => {},
  });

  assert.equal(joblit.calls.statuses.length, 2);
  assert.equal(summary.succeeded, 1);
  assert.equal(summary.failed, 0);
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

test("waits on a fresh running lease and retries until the batch is terminal", async () => {
  const joblit = fakeJoblit({
    steps: [
      {
        tasks: [],
        batchStatus: "RUNNING",
        retryAfterMs: 20_000,
        earliestLeaseExpiresAt: "2026-02-22T10:20:00.000Z",
      },
      { tasks: [], batchStatus: "SUCCEEDED" },
    ],
  });
  const hermes = fakeHermes();
  const waits = [];

  await processActiveBatch({
    joblit: joblit.client,
    hermes: hermes.client,
    leaseWaitMaxMs: 5,
    wait: async (ms) => {
      waits.push(ms);
    },
    log: () => {},
  });

  assert.deepEqual(waits, [5]);
  assert.equal(joblit.calls.runOnce.length, 2);
});

test("cancels promptly while waiting on another task lease", async () => {
  const controller = new AbortController();
  const joblit = fakeJoblit({
    steps: [
      {
        tasks: [],
        batchStatus: "RUNNING",
        retryAfterMs: 20_000,
      },
    ],
  });
  const hermes = fakeHermes();

  await processActiveBatch({
    joblit: joblit.client,
    hermes: hermes.client,
    signal: controller.signal,
    leaseWaitMaxMs: 5,
    wait: async (_ms, signal) => {
      controller.abort();
      assert.equal(signal.aborted, true);
    },
    log: () => {},
  });

  assert.equal(joblit.calls.runOnce.length, 1);
});
