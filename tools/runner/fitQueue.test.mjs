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
const CLAIM_ID = "55555555-5555-4555-8555-555555555555";
const ATTEMPT_ID = CLAIM;
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
    heartbeats: [],
  };
  let step = 0;
  return {
    calls,
    client: {
      async nextFitBatch() {
        calls.nextBatch += 1;
        const frame = script.batches[step] ?? {
          jobIds: [],
          pendingTotal: 0,
          leased: 0,
        };
        step += 1;
        return {
          jobIds: frame.jobIds ?? [],
          remaining: frame.remaining ?? 0,
          pendingTotal: frame.pendingTotal ?? 0,
          leased: frame.leased ?? 0,
          retryAfterMs: frame.retryAfterMs ?? null,
          claimToken: frame.jobIds?.length ? CLAIM : null,
          claimId: frame.claimId ?? null,
          attemptId: frame.attemptId ?? null,
        };
      },
      async fitPrompt(request) {
        calls.prompts.push(request);
        if (
          script.legacyPrompt &&
          calls.prompts.length === 1 &&
          "claimToken" in request
        ) {
          throw Object.assign(new Error("Invalid request body"), {
            code: "INVALID_BODY",
            status: 400,
          });
        }
        if (script.promptError) throw script.promptError;
        return {
          issueKey: ISSUE_KEY,
          prompt: {
            instructions: "triage system",
            input: `triage ${request.jobIds.length} jobs`,
            sessionId: ISSUE_KEY,
          },
          promptMeta: { promptHash: "hash-triage" },
          ...(script.fitClaim ? { fitClaim: script.fitClaim } : {}),
        };
      },
      async heartbeatFitClaim(request) {
        calls.heartbeats.push(request);
        if (script.heartbeatImpl) {
          return script.heartbeatImpl(request, calls.heartbeats.length);
        }
        if (script.heartbeatError) throw script.heartbeatError;
        return (
          script.heartbeatResult ?? {
            claimId: request.claimId,
            attemptId: request.attemptId,
            leaseExpiresAt: "2026-08-02T01:00:00.000Z",
            heartbeatAfterMs: 60_000,
          }
        );
      },
      async importFitBatch(request) {
        calls.imports.push(request);
        const importError = script.importErrors?.shift() ?? script.importError;
        if (importError) throw importError;
        if (script.importResult) return script.importResult;
        const scoredJobIds = script.scored ?? request.jobIds;
        const failed =
          script.failed ??
          request.jobIds
            .filter((jobId) => !scoredJobIds.includes(jobId))
            .map((jobId) => ({ jobId, code: "MODEL_RESULT_MISSING" }));
        return {
          settlement: {
            protocolVersion: 1,
            issueKey: ISSUE_KEY,
            requestHash: REQUEST_HASH,
            scored: scoredJobIds.map((jobId) => ({
              jobId,
              fitScore: 82,
              fitVerdict: "STRONG",
            })),
            ...(script.legacySettlement ? {} : { failed }),
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
        if (script.markFailedError) throw script.markFailedError;
        return script.markFailedResult ?? { count: request.jobIds.length };
      },
      async releaseFitBatch(request) {
        calls.released.push(request);
      },
    },
  };
}

function fakeHermes(script = {}) {
  const calls = {
    runs: [],
    acknowledgements: [],
    discards: [],
    reconciliations: [],
    recoveryScans: 0,
  };
  return {
    calls,
    client: {
      async generate(run) {
        calls.runs.push(run);
        if (script.generate) return script.generate(run, calls);
        if (script.failure) throw script.failure;
        return '[{"jobId":"x","matchScore":80}]';
      },
      async acknowledge(request) {
        calls.acknowledgements.push(request);
        if (script.acknowledgeFailure) throw script.acknowledgeFailure;
      },
      async discard(request) {
        calls.discards.push(request);
        if (script.discardFailure) throw script.discardFailure;
      },
      async reconcileObsolete(request) {
        calls.reconciliations.push(request);
        if (script.reconcileFailure) throw script.reconcileFailure;
        return { cleared: true };
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
  const joblit = fakeJoblit({
    batches: [{ jobIds: JOB_IDS, remaining: 0 }, {}],
  });
  const hermes = fakeHermes();
  const controller = new AbortController();

  const summary = await processFitQueue({
    joblit: joblit.client,
    hermes: hermes.client,
    signal: controller.signal,
    log: () => {},
  });

  assert.deepEqual(joblit.calls.prompts, [
    { jobIds: JOB_IDS, claimToken: CLAIM },
  ]);
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

test("a bounded Fit pass yields after one claim even when more are ready", async () => {
  const joblit = fakeJoblit({
    batches: [
      { jobIds: JOB_IDS, remaining: JOB_IDS.length },
      { jobIds: JOB_IDS, remaining: 0 },
      {},
    ],
  });
  const hermes = fakeHermes();

  const summary = await processFitQueue({
    joblit: joblit.client,
    hermes: hermes.client,
    maxBatches: 1,
    log: () => {},
  });

  assert.equal(joblit.calls.nextBatch, 1);
  assert.equal(hermes.calls.runs.length, 1);
  assert.equal(summary.scored, JOB_IDS.length);
});

test("a bounded Fit pass yields immediately when only leased work exists", async () => {
  const joblit = fakeJoblit({
    batches: [{ jobIds: [], pendingTotal: 3, leased: 3, retryAfterMs: 1 }, {}],
  });
  const hermes = fakeHermes();

  const summary = await processFitQueue({
    joblit: joblit.client,
    hermes: hermes.client,
    maxBatches: 1,
    leaseWaitMs: 1,
    log: () => {},
  });

  assert.equal(joblit.calls.nextBatch, 1);
  assert.equal(hermes.calls.runs.length, 0);
  assert.deepEqual(summary, { scored: 0, failed: 0, stopped: null });
});

test("retries the Fit prompt without claimToken only for an old strict server", async () => {
  const joblit = fakeJoblit({
    batches: [{ jobIds: JOB_IDS }, {}],
    legacyPrompt: true,
  });
  const hermes = fakeHermes();

  const summary = await processFitQueue({
    joblit: joblit.client,
    hermes: hermes.client,
    log: () => {},
  });

  assert.deepEqual(joblit.calls.prompts, [
    { jobIds: JOB_IDS, claimToken: CLAIM },
    { jobIds: JOB_IDS },
  ]);
  assert.equal(summary.scored, JOB_IDS.length);
});

test("heartbeats the exact durable Fit Claim while Hermes owns the model turn", async () => {
  const joblit = fakeJoblit({
    batches: [
      { jobIds: JOB_IDS, claimId: CLAIM_ID, attemptId: ATTEMPT_ID },
      {},
    ],
    fitClaim: { id: CLAIM_ID, attemptId: ATTEMPT_ID, issueKey: ISSUE_KEY },
  });
  const hermes = fakeHermes();

  const summary = await processFitQueue({
    joblit: joblit.client,
    hermes: hermes.client,
    log: () => {},
  });

  assert.deepEqual(joblit.calls.heartbeats, [
    { claimId: CLAIM_ID, attemptId: ATTEMPT_ID },
  ]);
  assert.deepEqual(joblit.calls.prompts, [
    {
      jobIds: JOB_IDS,
      claimToken: ATTEMPT_ID,
      claimId: CLAIM_ID,
      attemptId: ATTEMPT_ID,
    },
  ]);
  assert.equal(hermes.calls.runs.length, 1);
  assert.equal(summary.scored, JOB_IDS.length);
});

test("never downgrades a durable prompt binding after INVALID_BODY", async () => {
  const joblit = fakeJoblit({
    batches: [{ jobIds: JOB_IDS, claimId: CLAIM_ID, attemptId: ATTEMPT_ID }],
    fitClaim: { id: CLAIM_ID, attemptId: ATTEMPT_ID, issueKey: ISSUE_KEY },
    legacyPrompt: true,
  });
  const hermes = fakeHermes();

  const summary = await processFitQueue({
    joblit: joblit.client,
    hermes: hermes.client,
    log: () => {},
  });

  assert.equal(joblit.calls.prompts.length, 1);
  assert.deepEqual(joblit.calls.released, [
    { jobIds: JOB_IDS, claimToken: CLAIM },
  ]);
  assert.equal(hermes.calls.runs.length, 0);
  assert.match(summary.stopped, /invalid request body/i);
});

test("stops and preserves recovery when a durable Fit heartbeat loses authority", async () => {
  const expired = Object.assign(new Error("Fit Claim is no longer active"), {
    code: "FIT_CLAIM_EXPIRED",
    status: 409,
  });
  let signalHeartbeatLost;
  const heartbeatLost = new Promise((resolve) => {
    signalHeartbeatLost = resolve;
  });
  const joblit = fakeJoblit({
    batches: [{ jobIds: JOB_IDS, claimId: CLAIM_ID, attemptId: ATTEMPT_ID }],
    fitClaim: { id: CLAIM_ID, attemptId: ATTEMPT_ID, issueKey: ISSUE_KEY },
    heartbeatImpl(request, count) {
      if (count > 1) {
        signalHeartbeatLost();
        throw expired;
      }
      return {
        claimId: request.claimId,
        attemptId: request.attemptId,
        leaseExpiresAt: "2026-08-02T01:00:00.000Z",
        heartbeatAfterMs: 1,
      };
    },
  });
  const controller = new AbortController();
  const hermes = fakeHermes({
    async generate({ signal }) {
      await heartbeatLost;
      assert.equal(signal, controller.signal);
      assert.equal(signal.aborted, false);
      return '[{"jobId":"x","matchScore":80}]';
    },
  });

  const summary = await processFitQueue({
    joblit: joblit.client,
    hermes: hermes.client,
    signal: controller.signal,
    heartbeatWait: async () => {},
    log: () => {},
  });

  assert.equal(joblit.calls.heartbeats.length, 2);
  assert.equal(joblit.calls.released.length, 0);
  assert.equal(joblit.calls.markFailed.length, 0);
  assert.equal(hermes.calls.runs[0].signal.aborted, false);
  assert.match(summary.stopped, /heartbeat/i);
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
  assert.deepEqual(joblit.calls.markFailed, [
    { jobIds: JOB_IDS, claimToken: CLAIM },
  ]);
  assert.equal(summary.failed, 2);
});

test("does not report model failure after the Fit authority was cancelled or superseded", async () => {
  const cases = [
    { markFailedResult: { count: 0 } },
    {
      markFailedError: Object.assign(new Error("attempt changed"), {
        code: "FIT_ATTEMPT_STALE",
        status: 409,
      }),
    },
  ];
  for (const script of cases) {
    const joblit = fakeJoblit({
      batches: [{ jobIds: JOB_IDS }],
      ...script,
    });
    const hermes = fakeHermes({ failure: new Error("model failed") });

    const summary = await processFitQueue({
      joblit: joblit.client,
      hermes: hermes.client,
      log: () => {},
    });

    assert.equal(summary.failed, 0);
    assert.match(summary.stopped, /cancelled|superseded/i);
    assert.equal(joblit.calls.markFailed.length, 1);
  }
});

test("defers retryable Hermes HTTP failures without terminalizing the Fit Claim", async () => {
  for (const status of [408, 425, 429, 503]) {
    const joblit = fakeJoblit({ batches: [{ jobIds: JOB_IDS }] });
    const hermes = fakeHermes({
      failure: Object.assign(new Error(`Hermes HTTP ${status}`), {
        code: "HERMES_HTTP_ERROR",
        status,
      }),
    });

    const summary = await processFitQueue({
      joblit: joblit.client,
      hermes: hermes.client,
      log: () => {},
    });

    assert.equal(summary.failed, 0, `status ${status}`);
    assert.match(summary.stopped, /unknown/i, `status ${status}`);
    assert.equal(joblit.calls.markFailed.length, 0, `status ${status}`);
    assert.equal(joblit.calls.released.length, 0, `status ${status}`);
  }
});

test("uses the atomic settlement's scored and failed counts without a second mutation", async () => {
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
  assert.equal(joblit.calls.markFailed.length, 0);
});

test("accepts an all-failed atomic settlement with no scored jobs", async () => {
  const joblit = fakeJoblit({
    batches: [{ jobIds: JOB_IDS }, {}],
    scored: [],
    failed: JOB_IDS.map((jobId, index) => ({
      jobId,
      code: index === 0 ? "MODEL_RESULT_MISSING" : "JOB_UNAVAILABLE",
    })),
  });
  const hermes = fakeHermes();

  const summary = await processFitQueue({
    joblit: joblit.client,
    hermes: hermes.client,
    log: () => {},
  });

  assert.deepEqual(summary, { scored: 0, failed: 2, stopped: null });
  assert.equal(joblit.calls.markFailed.length, 0);
  assert.equal(hermes.calls.acknowledgements.length, 1);
});

test("keeps old settlements compatible and cleans up only their implicit misses", async () => {
  const joblit = fakeJoblit({
    batches: [{ jobIds: JOB_IDS }, {}],
    scored: [JOB_IDS[0]],
    legacySettlement: true,
  });
  const hermes = fakeHermes();

  const summary = await processFitQueue({
    joblit: joblit.client,
    hermes: hermes.client,
    log: () => {},
  });

  assert.deepEqual(summary, { scored: 1, failed: 1, stopped: null });
  assert.deepEqual(joblit.calls.markFailed, [
    { jobIds: JOB_IDS, claimToken: CLAIM },
  ]);
});

test("rejects a new settlement that does not cover the exact claimed Job set", async () => {
  const joblit = fakeJoblit({
    batches: [{ jobIds: JOB_IDS }],
    importResult: {
      settlement: {
        protocolVersion: 1,
        issueKey: ISSUE_KEY,
        requestHash: REQUEST_HASH,
        scored: [{ jobId: JOB_IDS[0], fitScore: 82, fitVerdict: "STRONG" }],
        failed: [],
      },
    },
  });
  const hermes = fakeHermes();

  const summary = await processFitQueue({
    joblit: joblit.client,
    hermes: hermes.client,
    log: () => {},
  });

  assert.equal(joblit.calls.markFailed.length, 0);
  assert.equal(hermes.calls.acknowledgements.length, 0);
  assert.match(summary.stopped, /settlement.*invalid/i);
});

test("rejects duplicate Job coverage across scored and failed outcomes", async () => {
  const joblit = fakeJoblit({
    batches: [{ jobIds: JOB_IDS }],
    importResult: {
      settlement: {
        protocolVersion: 1,
        issueKey: ISSUE_KEY,
        requestHash: REQUEST_HASH,
        scored: [{ jobId: JOB_IDS[0], fitScore: 82, fitVerdict: "STRONG" }],
        failed: [
          { jobId: JOB_IDS[0], code: "MODEL_RESULT_MISSING" },
          { jobId: JOB_IDS[1], code: "JOB_UNAVAILABLE" },
        ],
      },
    },
  });
  const hermes = fakeHermes();

  const summary = await processFitQueue({
    joblit: joblit.client,
    hermes: hermes.client,
    log: () => {},
  });

  assert.equal(joblit.calls.markFailed.length, 0);
  assert.equal(hermes.calls.acknowledgements.length, 0);
  assert.match(summary.stopped, /settlement.*invalid/i);
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

test("replays retryable import statuses because a committed response may have been lost", async () => {
  for (const status of [408, 425, 429, 502]) {
    const retryableFailure = Object.assign(
      new Error(`Retryable import status ${status}`),
      {
        code: "JOBLIT_HTTP_ERROR",
        status,
      },
    );
    const joblit = fakeJoblit({
      batches: [{ jobIds: JOB_IDS }, {}],
      importErrors: [retryableFailure],
    });
    const hermes = fakeHermes();

    const summary = await processFitQueue({
      joblit: joblit.client,
      hermes: hermes.client,
      log: () => {},
    });

    assert.equal(joblit.calls.imports.length, 2, `status ${status}`);
    assert.equal(hermes.calls.acknowledgements.length, 1, `status ${status}`);
    assert.equal(joblit.calls.markFailed.length, 0, `status ${status}`);
    assert.equal(summary.scored, 2, `status ${status}`);
  }
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
      status: "SETTLED",
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

test("preserves a completed Fit result while settlement status remains ACTIVE", async () => {
  const joblit = fakeJoblit({
    batches: [{}],
    recoveryResult: { status: "ACTIVE", settlement: null },
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

  assert.deepEqual(joblit.calls.settlements, [ISSUE_KEY]);
  assert.equal(hermes.calls.acknowledgements.length, 0);
});

test("discards a completed Fit result only after terminal-without-receipt proof", async () => {
  const joblit = fakeJoblit({
    batches: [{}],
    recoveryResult: {
      status: "TERMINAL_WITHOUT_RECEIPT",
      settlement: null,
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

  assert.deepEqual(hermes.calls.discards, [
    { sessionId: `joblit:fit:${ISSUE_KEY}` },
  ]);
  assert.equal(hermes.calls.acknowledgements.length, 0);
});

test("retires live Fit state only after Joblit proves settlement or terminality", async () => {
  const cases = [
    {
      phase: "running",
      recoveryResult: {
        status: "SETTLED",
        settlement: {
          protocolVersion: 1,
          issueKey: ISSUE_KEY,
          requestHash: REQUEST_HASH,
          scored: JOB_IDS.map((jobId) => ({
            jobId,
            fitScore: 82,
            fitVerdict: "STRONG",
          })),
          failed: [],
        },
      },
    },
    {
      phase: "starting",
      recoveryResult: {
        status: "TERMINAL_WITHOUT_RECEIPT",
        settlement: null,
      },
    },
  ];

  for (const { phase, recoveryResult } of cases) {
    const joblit = fakeJoblit({
      batches: [{}],
      recoveryResult,
    });
    const sessionId = `joblit:fit:${ISSUE_KEY}`;
    const hermes = fakeHermes({
      recoverable: [{ sessionId, issueKey: ISSUE_KEY, phase }],
    });

    await processFitQueue({
      joblit: joblit.client,
      hermes: hermes.client,
      log: () => {},
    });

    assert.deepEqual(
      hermes.calls.reconciliations,
      [{ sessionId, signal: undefined }],
      phase,
    );
    assert.equal(hermes.calls.acknowledgements.length, 0, phase);
    assert.equal(hermes.calls.discards.length, 0, phase);
  }
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

test("releases the claim and stops on an authoritative Hermes cancellation", async () => {
  const cancelled = Object.assign(new Error("Hermes run cancelled"), {
    code: "RUN_CANCELLED",
  });
  const joblit = fakeJoblit({ batches: [{ jobIds: JOB_IDS }, {}] });
  const hermes = fakeHermes({ failure: cancelled });

  const summary = await processFitQueue({
    joblit: joblit.client,
    hermes: hermes.client,
    log: () => {},
  });

  assert.deepEqual(joblit.calls.released, [
    { jobIds: JOB_IDS, claimToken: CLAIM },
  ]);
  assert.equal(joblit.calls.markFailed.length, 0);
  assert.equal(summary.failed, 0);
  assert.match(summary.stopped, /cancelled/i);
});

test("treats expired and stale Fit attempts as superseded rather than model failure", async () => {
  for (const code of ["FIT_CLAIM_EXPIRED", "FIT_ATTEMPT_STALE"]) {
    const superseded = Object.assign(new Error("claim is no longer active"), {
      code,
      status: 409,
    });
    const joblit = fakeJoblit({
      batches: [{ jobIds: JOB_IDS }],
      importError: superseded,
    });
    const hermes = fakeHermes();

    const summary = await processFitQueue({
      joblit: joblit.client,
      hermes: hermes.client,
      log: () => {},
    });

    assert.equal(joblit.calls.markFailed.length, 0, code);
    assert.equal(hermes.calls.acknowledgements.length, 0, code);
    assert.equal(summary.failed, 0, code);
    assert.match(summary.stopped, /cancelled|superseded/i, code);
  }
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
  const joblit = fakeJoblit({
    batches: [{ jobIds: [], pendingTotal: 0, leased: 0 }],
  });
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
  assert.deepEqual(joblit.calls.released, [
    { jobIds: JOB_IDS, claimToken: CLAIM },
  ]);
  assert.equal(joblit.calls.markFailed.length, 0);
  assert.equal(hermes.calls.runs.length, 0);
  assert.equal(summary.stopped, "Create your resume first");
});
