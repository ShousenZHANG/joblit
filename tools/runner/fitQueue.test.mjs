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
const ISSUE_KEY = "d".repeat(64);
const REQUEST_HASH = "e".repeat(64);
const JOB_IDS = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
];

function fakeJoblit(script) {
  const calls = {
    nextBatch: 0,
    prompts: [],
    imports: [],
    settlements: [],
    markFailed: [],
    released: [],
  };
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
          issueKey: ISSUE_KEY,
          prompt: {
            instructions: "triage system",
            input: `triage ${request.jobIds.length} jobs`,
            sessionId: ISSUE_KEY,
          },
          promptMeta: { promptHash: "hash-triage" },
        };
      },
      async importFitBatch(request) {
        calls.imports.push(request);
        const importError = script.importErrors?.shift() ?? script.importError;
        if (importError) throw importError;
        if (script.importResult) return script.importResult;
        return {
          settlement: {
            protocolVersion: 1,
            issueKey: ISSUE_KEY,
            requestHash: REQUEST_HASH,
            scored: (script.scored ?? request.jobIds).map((jobId) => ({
              jobId,
              fitScore: 82,
              fitVerdict: "STRONG",
            })),
          },
        };
      },
      async fitSettlement(issueKey) {
        calls.settlements.push(issueKey);
        if (script.settlementError) throw script.settlementError;
        return script.recoveryResult ?? { settlement: null };
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
  const calls = { runs: [], acknowledgements: [], recoveryScans: 0 };
  return {
    calls,
    client: {
      async generate(run) {
        calls.runs.push(run);
        if (script.failure) throw script.failure;
        return '[{"jobId":"x","matchScore":80}]';
      },
      async acknowledge(request) {
        calls.acknowledgements.push(request);
        if (script.acknowledgeFailure) throw script.acknowledgeFailure;
      },
      async recoverableFitIssues() {
        calls.recoveryScans += 1;
        if (script.recoveryError) throw script.recoveryError;
        return script.recoverable ?? [];
      },
    },
  };
}

test("scores a claimed batch through Hermes and imports the result", async () => {
  const joblit = fakeJoblit({ batches: [{ jobIds: JOB_IDS, remaining: 0 }, {}] });
  const hermes = fakeHermes();
  const controller = new AbortController();

  const summary = await processFitQueue({
    joblit: joblit.client,
    hermes: hermes.client,
    signal: controller.signal,
    log: () => {},
  });

  assert.deepEqual(joblit.calls.prompts, [{ jobIds: JOB_IDS }]);
  assert.equal(hermes.calls.runs.length, 1);
  assert.equal(hermes.calls.runs[0].instructions, "triage system");
  assert.equal(hermes.calls.runs[0].sessionId, `joblit:fit:${ISSUE_KEY}`);
  assert.equal(hermes.calls.runs[0].signal, controller.signal);

  assert.equal(joblit.calls.imports.length, 1);
  assert.deepEqual(joblit.calls.imports[0], {
    jobIds: JOB_IDS,
    claimToken: CLAIM,
    issueKey: ISSUE_KEY,
    modelOutput: '[{"jobId":"x","matchScore":80}]',
    promptMeta: { promptHash: "hash-triage" },
  });
  assert.deepEqual(hermes.calls.acknowledgements, [
    { sessionId: `joblit:fit:${ISSUE_KEY}` },
  ]);

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

test("does not reverse a durable Fit settlement when local cleanup fails", async () => {
  const joblit = fakeJoblit({
    batches: [{ jobIds: JOB_IDS }, {}],
  });
  const hermes = fakeHermes({
    acknowledgeFailure: new Error("runner state file is locked"),
  });

  const summary = await processFitQueue({
    joblit: joblit.client,
    hermes: hermes.client,
    cleanupRetryMs: 1,
    log: () => {},
  });

  assert.equal(joblit.calls.imports.length, 1);
  assert.equal(joblit.calls.markFailed.length, 0);
  assert.equal(joblit.calls.nextBatch, 2);
  assert.equal(hermes.calls.acknowledgements.length, 3);
  assert.equal(summary.scored, 2);
  assert.equal(summary.failed, 0);
  assert.equal(summary.stopped, null);
});

test("replays an uncertain import and acknowledges only its durable settlement", async () => {
  const uncertain = Object.assign(new Error("socket closed after commit"), {
    code: "JOBLIT_TRANSPORT_ERROR",
  });
  const joblit = fakeJoblit({
    batches: [{ jobIds: JOB_IDS }, {}],
    importErrors: [uncertain],
  });
  const hermes = fakeHermes();

  const summary = await processFitQueue({
    joblit: joblit.client,
    hermes: hermes.client,
    log: () => {},
  });

  assert.equal(joblit.calls.imports.length, 2);
  assert.deepEqual(joblit.calls.imports[1], joblit.calls.imports[0]);
  assert.deepEqual(hermes.calls.acknowledgements, [
    { sessionId: `joblit:fit:${ISSUE_KEY}` },
  ]);
  assert.equal(joblit.calls.markFailed.length, 0);
  assert.equal(summary.scored, 2);
});

test("replays a 5xx import because an upstream may have lost a committed response", async () => {
  const gatewayFailure = Object.assign(new Error("Bad gateway"), {
    code: "JOBLIT_HTTP_ERROR",
    status: 502,
  });
  const joblit = fakeJoblit({
    batches: [{ jobIds: JOB_IDS }, {}],
    importErrors: [gatewayFailure],
  });
  const hermes = fakeHermes();

  const summary = await processFitQueue({
    joblit: joblit.client,
    hermes: hermes.client,
    log: () => {},
  });

  assert.equal(joblit.calls.imports.length, 2);
  assert.equal(hermes.calls.acknowledgements.length, 1);
  assert.equal(joblit.calls.markFailed.length, 0);
  assert.equal(summary.scored, 2);
});

test("keeps the claim and Hermes state when settlement remains unknown", async () => {
  const first = Object.assign(new Error("first response lost"), {
    code: "JOBLIT_TRANSPORT_ERROR",
  });
  const second = Object.assign(new Error("second response lost"), {
    code: "JOBLIT_REQUEST_TIMEOUT",
  });
  const joblit = fakeJoblit({
    batches: [{ jobIds: JOB_IDS }],
    importErrors: [first, second],
  });
  const hermes = fakeHermes();

  const summary = await processFitQueue({
    joblit: joblit.client,
    hermes: hermes.client,
    log: () => {},
  });

  assert.equal(joblit.calls.imports.length, 2);
  assert.equal(hermes.calls.acknowledgements.length, 0);
  assert.equal(joblit.calls.markFailed.length, 0);
  assert.match(summary.stopped, /settlement.*unknown/i);
});

test("reconciles a committed Fit receipt after both import responses were lost", async () => {
  const joblit = fakeJoblit({
    batches: [{}],
    recoveryResult: {
      settlement: {
        protocolVersion: 1,
        issueKey: ISSUE_KEY,
        requestHash: REQUEST_HASH,
        scored: JOB_IDS.map((jobId) => ({
          jobId,
          fitScore: 82,
          fitVerdict: "STRONG",
        })),
      },
    },
  });
  const hermes = fakeHermes({
    recoverable: [
      { sessionId: `joblit:fit:${ISSUE_KEY}`, issueKey: ISSUE_KEY },
    ],
  });

  const summary = await processFitQueue({
    joblit: joblit.client,
    hermes: hermes.client,
    log: () => {},
  });

  assert.deepEqual(joblit.calls.settlements, [ISSUE_KEY]);
  assert.deepEqual(hermes.calls.acknowledgements, [
    { sessionId: `joblit:fit:${ISSUE_KEY}` },
  ]);
  assert.equal(hermes.calls.runs.length, 0);
  assert.equal(joblit.calls.imports.length, 0);
  assert.deepEqual(summary, { scored: 0, failed: 0, stopped: null });
});

test("preserves a completed Fit result when no server receipt exists yet", async () => {
  const joblit = fakeJoblit({ batches: [{}] });
  const hermes = fakeHermes({
    recoverable: [
      { sessionId: `joblit:fit:${ISSUE_KEY}`, issueKey: ISSUE_KEY },
    ],
  });

  await processFitQueue({
    joblit: joblit.client,
    hermes: hermes.client,
    log: () => {},
  });

  assert.deepEqual(joblit.calls.settlements, [ISSUE_KEY]);
  assert.equal(hermes.calls.acknowledgements.length, 0);
});

test("preserves Fit recovery state when the receipt response is mismatched", async () => {
  const joblit = fakeJoblit({
    batches: [{}],
    recoveryResult: {
      settlement: {
        protocolVersion: 1,
        issueKey: "f".repeat(64),
        requestHash: REQUEST_HASH,
        scored: [
          {
            jobId: JOB_IDS[0],
            fitScore: 82,
            fitVerdict: "STRONG",
          },
        ],
      },
    },
  });
  const hermes = fakeHermes({
    recoverable: [
      { sessionId: `joblit:fit:${ISSUE_KEY}`, issueKey: ISSUE_KEY },
    ],
  });

  await processFitQueue({
    joblit: joblit.client,
    hermes: hermes.client,
    log: () => {},
  });

  assert.equal(hermes.calls.acknowledgements.length, 0);
});

test("defers an ambiguous Hermes start and keeps the lease for an exact resume", async () => {
  const unknown = Object.assign(new Error("start response lost"), {
    code: "RUN_START_UNKNOWN",
  });
  const joblit = fakeJoblit({ batches: [{ jobIds: JOB_IDS }] });
  const hermes = fakeHermes({ failure: unknown });

  const summary = await processFitQueue({
    joblit: joblit.client,
    hermes: hermes.client,
    log: () => {},
  });

  // The lease is deliberately NOT released. The same jobs re-leased in the
  // same composition produce the same issueKey, and generate() resumes the
  // tracked run instead of paying for a second model call; releasing invites
  // a different batch composition, which strands the completed Hermes state
  // with no receipt to reconcile against.
  assert.equal(joblit.calls.released.length, 0);
  assert.equal(joblit.calls.markFailed.length, 0);
  assert.equal(summary.failed, 0);
  assert.match(summary.stopped, /unknown/i);
});

test("treats an expired Fit claim as cancellation rather than model failure", async () => {
  const cancelled = Object.assign(new Error("claim is no longer active"), {
    code: "FIT_CLAIM_EXPIRED",
    status: 409,
  });
  const joblit = fakeJoblit({
    batches: [{ jobIds: JOB_IDS }],
    importError: cancelled,
  });
  const hermes = fakeHermes();

  const summary = await processFitQueue({
    joblit: joblit.client,
    hermes: hermes.client,
    log: () => {},
  });

  assert.equal(joblit.calls.markFailed.length, 0);
  assert.equal(hermes.calls.acknowledgements.length, 0);
  assert.equal(summary.failed, 0);
  assert.match(summary.stopped, /cancelled|superseded/i);
});

test("does not acknowledge a malformed or mismatched settlement", async () => {
  const joblit = fakeJoblit({
    batches: [{ jobIds: JOB_IDS }],
    importResult: {
      settlement: {
        protocolVersion: 1,
        issueKey: "f".repeat(64),
        requestHash: REQUEST_HASH,
        scored: JOB_IDS.map((jobId) => ({
          jobId,
          fitScore: 82,
          fitVerdict: "STRONG",
        })),
      },
    },
  });
  const hermes = fakeHermes();

  const summary = await processFitQueue({
    joblit: joblit.client,
    hermes: hermes.client,
    log: () => {},
  });

  assert.equal(hermes.calls.acknowledgements.length, 0);
  assert.equal(joblit.calls.markFailed.length, 0);
  assert.match(summary.stopped, /settlement.*invalid/i);
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
