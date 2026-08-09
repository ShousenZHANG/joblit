import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createHermesClient } from "./hermesClient.mjs";
import { createJoblitClient } from "./joblitClient.mjs";
import { createFileRunStateStore } from "./runStateStore.mjs";

const AGENT_TOKEN = `jfagent_v1_${"a".repeat(64)}`;
const TAILORING_OPERATION = {
  tailoringRunId: "55555555-5555-4555-8555-555555555555",
  attemptId: "22222222-2222-4222-8222-222222222222",
  target: "resume",
  promptHash: "c".repeat(64),
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function withMissingSession(fetchImpl) {
  return async (url, init = {}) => {
    if (
      String(url).includes("/api/sessions/") &&
      String(url).endsWith("/messages")
    ) {
      return jsonResponse(
        { error: { code: "session_not_found", message: "not found" } },
        404,
      );
    }
    return fetchImpl(url, init);
  };
}

test("hermes: starts a run, polls to completion, returns the output", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/v1/runs") && init.method === "POST") {
      return jsonResponse({
        status: "started",
        run_id: "run_" + "a".repeat(32),
      });
    }
    if (String(url).includes("/v1/runs/run_")) {
      // First poll still running, second completed.
      const polls = calls.filter((c) => c.init.method !== "POST").length;
      return jsonResponse(
        polls < 2
          ? {
              object: "hermes.run",
              run_id: "run_" + "a".repeat(32),
              status: "running",
            }
          : {
              object: "hermes.run",
              run_id: "run_" + "a".repeat(32),
              status: "completed",
              output: '{"cvSummary":"done"}',
            },
      );
    }
    return jsonResponse({ error: "unexpected" }, 500);
  };

  const hermes = createHermesClient({
    baseUrl: "http://127.0.0.1:8790",
    apiKey: "local-key",
    fetchImpl: withMissingSession(fetchImpl),
    pollMs: 1,
  });

  const output = await hermes.generate({
    instructions: "system",
    input: "user",
    sessionId: "joblit:11111111-1111-4111-8111-111111111111",
  });

  assert.equal(output, '{"cvSummary":"done"}');
  const start = calls[0];
  assert.match(start.url, /\/v1\/runs$/);
  assert.equal(start.init.headers.Authorization, "Bearer local-key");
  assert.deepEqual(JSON.parse(start.init.body), {
    instructions: "system",
    input: "user",
    session_id: "joblit:11111111-1111-4111-8111-111111111111",
  });
});

test("hermes: keeps a completed run recoverable until Joblit import is acknowledged", async () => {
  const runId = "run_" + "9".repeat(32);
  const sessionId = "joblit:durable-import";
  const state = new Map();
  const runStateStore = {
    async get(key) {
      return state.get(key) ?? null;
    },
    async set(key, value) {
      state.set(key, value);
    },
    async delete(key) {
      state.delete(key);
    },
  };
  const hermes = createHermesClient({
    baseUrl: "http://127.0.0.1:8790",
    apiKey: "k",
    pollMs: 1,
    runStateStore,
    fetchImpl: withMissingSession(async (_url, init = {}) =>
      init.method === "POST"
        ? jsonResponse({ status: "started", run_id: runId })
        : jsonResponse({
            object: "hermes.run",
            run_id: runId,
            status: "completed",
            output: '{"cvSummary":"durable"}',
          }),
    ),
  });

  await hermes.generate({ instructions: "s", input: "u", sessionId });
  assert.deepEqual(state.get(sessionId), {
    phase: "completed",
    runId,
    repairUsed: false,
  });

  await hermes.acknowledge({ sessionId });
  assert.equal(state.has(sessionId), false);
});

test("hermes: exposes only safe completed operation metadata for startup reconciliation", async () => {
  const runId = "run_" + "8".repeat(32);
  const sessionId = "joblit:recoverable-operation";
  const state = new Map();
  const runStateStore = {
    async get(key) {
      return state.get(key) ?? null;
    },
    async set(key, value) {
      state.set(key, structuredClone(value));
    },
    async delete(key) {
      state.delete(key);
    },
    async list() {
      return [...state].map(([storedSessionId, storedState]) => ({
        sessionId: storedSessionId,
        state: structuredClone(storedState),
      }));
    },
  };
  const hermes = createHermesClient({
    baseUrl: "http://127.0.0.1:8790",
    apiKey: "k",
    pollMs: 1,
    runStateStore,
    fetchImpl: withMissingSession(async (_url, init = {}) =>
      init.method === "POST"
        ? jsonResponse({ status: "started", run_id: runId })
        : jsonResponse({
            object: "hermes.run",
            run_id: runId,
            status: "completed",
            output: '{"privateResume":"must stay in memory only"}',
          }),
    ),
  });

  await hermes.generate({
    instructions: "private system prompt",
    input: "private job description",
    sessionId,
    operation: TAILORING_OPERATION,
  });

  assert.deepEqual(await hermes.recoverableOperations(), [
    {
      sessionId,
      phase: "completed",
      operation: TAILORING_OPERATION,
    },
  ]);
  assert.deepEqual(state.get(sessionId), {
    phase: "completed",
    runId,
    repairUsed: false,
    operation: TAILORING_OPERATION,
  });

  await hermes.discard({ sessionId });
  assert.deepEqual(await hermes.recoverableOperations(), []);
});

test("hermes: exposes content-addressed Fit issues across recoverable phases", async () => {
  const issueKey = "d".repeat(64);
  const state = new Map([
    [
      `joblit:fit:${issueKey}`,
      {
        phase: "completed",
        runId: "run_" + "d".repeat(32),
        repairUsed: false,
      },
    ],
    [
      `joblit:fit:${"e".repeat(64)}`,
      {
        phase: "running",
        runId: "run_" + "e".repeat(32),
        repairUsed: false,
      },
    ],
    [
      "joblit:not-a-fit-issue",
      {
        phase: "completed",
        runId: "run_" + "f".repeat(32),
        repairUsed: false,
      },
    ],
  ]);
  const hermes = createHermesClient({
    baseUrl: "http://127.0.0.1:8790",
    apiKey: "k",
    runStateStore: {
      async get(key) {
        return state.get(key) ?? null;
      },
      async set(key, value) {
        state.set(key, structuredClone(value));
      },
      async delete(key) {
        state.delete(key);
      },
      async list() {
        return [...state].map(([sessionId, storedState]) => ({
          sessionId,
          state: structuredClone(storedState),
        }));
      },
    },
  });

  assert.deepEqual(await hermes.recoverableFitIssues(), [
    {
      sessionId: `joblit:fit:${issueKey}`,
      issueKey,
      phase: "completed",
    },
    {
      sessionId: `joblit:fit:${"e".repeat(64)}`,
      issueKey: "e".repeat(64),
      phase: "running",
    },
  ]);
});

test("hermes: refuses to recover completed output for a different prompt operation", async () => {
  const sessionId = "joblit:operation-mismatch";
  const state = new Map([
    [
      sessionId,
      {
        phase: "completed",
        runId: "run_" + "6".repeat(32),
        repairUsed: false,
        operation: TAILORING_OPERATION,
      },
    ],
  ]);
  const hermes = createHermesClient({
    baseUrl: "http://127.0.0.1:8790",
    apiKey: "k",
    runStateStore: {
      async get(key) {
        return state.get(key) ?? null;
      },
      async set(key, value) {
        state.set(key, value);
      },
      async delete(key) {
        state.delete(key);
      },
    },
    fetchImpl: async () => {
      throw new Error("Hermes must not be called for mismatched recovery");
    },
  });

  await assert.rejects(
    hermes.generate({
      instructions: "new prompt",
      input: "new input",
      sessionId,
      operation: { ...TAILORING_OPERATION, promptHash: "d".repeat(64) },
    }),
    (error) => error?.code === "RUN_OPERATION_MISMATCH",
  );
});

test("hermes: safely rebinds the same prompt operation to a renewed lease attempt", async () => {
  const sessionId = "joblit:operation-reclaimed";
  const runId = "run_" + "5".repeat(32);
  const renewedOperation = {
    ...TAILORING_OPERATION,
    attemptId: "77777777-7777-4777-8777-777777777777",
  };
  const state = new Map([
    [
      sessionId,
      {
        phase: "completed",
        runId,
        repairUsed: false,
        operation: TAILORING_OPERATION,
      },
    ],
  ]);
  const calls = [];
  const hermes = createHermesClient({
    baseUrl: "http://127.0.0.1:8790",
    apiKey: "k",
    pollMs: 1,
    runStateStore: {
      async get(key) {
        return state.get(key) ?? null;
      },
      async set(key, value) {
        state.set(key, structuredClone(value));
      },
      async delete(key) {
        state.delete(key);
      },
    },
    fetchImpl: withMissingSession(async (url, init = {}) => {
      calls.push({ url: String(url), init });
      assert.notEqual(init.method, "POST");
      return jsonResponse({
        object: "hermes.run",
        run_id: runId,
        status: "completed",
        output: '{"cvSummary":"reused safely"}',
      });
    }),
  });

  assert.equal(
    await hermes.generate({
      instructions: "same prompt",
      input: "same input",
      sessionId,
      operation: renewedOperation,
    }),
    '{"cvSummary":"reused safely"}',
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(state.get(sessionId)?.operation, renewedOperation);
});

test("hermes: a failed run surfaces the gateway's error", async () => {
  const fetchImpl = async (url, init = {}) => {
    if (init.method === "POST") {
      return jsonResponse({
        status: "started",
        run_id: "run_" + "b".repeat(32),
      });
    }
    return jsonResponse({
      object: "hermes.run",
      run_id: "run_" + "b".repeat(32),
      status: "failed",
      error: "model exploded",
    });
  };

  const hermes = createHermesClient({
    baseUrl: "http://127.0.0.1:8790",
    apiKey: "k",
    fetchImpl: withMissingSession(fetchImpl),
    pollMs: 1,
  });

  await assert.rejects(
    hermes.generate({ instructions: "s", input: "u", sessionId: "joblit:x" }),
    (error) =>
      error?.code === "RUN_FAILED" && /model exploded/.test(error.message),
  );
});

test("hermes: a terminal cancelled status is typed and clears its durable run", async () => {
  const sessionId = "joblit:remote-cancelled";
  const runId = "run_" + "4".repeat(32);
  const state = new Map();
  const hermes = createHermesClient({
    baseUrl: "http://127.0.0.1:8790",
    apiKey: "k",
    pollMs: 1,
    runStateStore: {
      async get(key) {
        return state.get(key) ?? null;
      },
      async set(key, value) {
        state.set(key, structuredClone(value));
      },
      async delete(key) {
        state.delete(key);
      },
    },
    fetchImpl: withMissingSession(async (_url, init = {}) =>
      init.method === "POST"
        ? jsonResponse({ status: "started", run_id: runId })
        : jsonResponse({
            object: "hermes.run",
            run_id: runId,
            status: "cancelled",
            error: "cancelled by Hermes",
          }),
    ),
  });

  await assert.rejects(
    hermes.generate({ instructions: "s", input: "u", sessionId }),
    (error) =>
      error?.code === "RUN_CANCELLED" &&
      /cancelled by Hermes/.test(error.message),
  );
  assert.equal(state.has(sessionId), false);
});

test("hermes: rejects an unknown run status as a protocol error", async () => {
  const runId = "run_" + "2".repeat(32);
  const hermes = createHermesClient({
    baseUrl: "http://127.0.0.1:8790",
    apiKey: "k",
    pollMs: 1,
    timeoutMs: 20,
    fetchImpl: withMissingSession(async (url, init = {}) => {
      if (init.method === "POST") {
        return jsonResponse({ status: "started", run_id: runId });
      }
      return jsonResponse({
        object: "hermes.run",
        run_id: runId,
        status: "invented",
      });
    }),
  });

  await assert.rejects(
    hermes.generate({ instructions: "s", input: "u", sessionId: "joblit:x" }),
    (error) => error?.code === "HERMES_PROTOCOL_ERROR",
  );
});

test("hermes: refuses a non-loopback gateway", () => {
  // The key is a local credential; sending it anywhere but 127.0.0.1 turns a
  // config typo into credential exfiltration.
  assert.throws(
    () =>
      createHermesClient({
        baseUrl: "http://evil.example.com",
        apiKey: "k",
        fetchImpl: async () => jsonResponse({}),
      }),
    /loopback/i,
  );
});

test("hermes: times out a run that never finishes", async () => {
  const fetchImpl = async (url, init = {}) => {
    if (init.method === "POST") {
      return jsonResponse({
        status: "started",
        run_id: "run_" + "c".repeat(32),
      });
    }
    return jsonResponse({
      object: "hermes.run",
      run_id: "run_" + "c".repeat(32),
      status: "running",
    });
  };

  const hermes = createHermesClient({
    baseUrl: "http://localhost:8790",
    apiKey: "k",
    fetchImpl: withMissingSession(fetchImpl),
    pollMs: 1,
    timeoutMs: 20,
  });

  await assert.rejects(
    hermes.generate({ instructions: "s", input: "u", sessionId: "joblit:x" }),
    /timed out/i,
  );
});

test("hermes: aborting a known run posts stop before reporting cancellation", async () => {
  const runId = "run_" + "d".repeat(32);
  const calls = [];
  const controller = new AbortController();
  let polls = 0;
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/v1/runs") && init.method === "POST") {
      return jsonResponse({ status: "started", run_id: runId });
    }
    if (String(url).endsWith(`/v1/runs/${runId}/stop`)) {
      return jsonResponse({ status: "stopping", run_id: runId });
    }
    assert.equal(init.signal.aborted, false);
    polls += 1;
    if (polls === 1) {
      controller.abort();
      assert.equal(init.signal.aborted, true);
    }
    return jsonResponse({
      object: "hermes.run",
      run_id: runId,
      status: polls === 1 ? "running" : "cancelled",
    });
  };
  const hermes = createHermesClient({
    baseUrl: "http://127.0.0.1:8790",
    apiKey: "k",
    fetchImpl: withMissingSession(fetchImpl),
    pollMs: 1,
  });

  await assert.rejects(
    hermes.generate({
      instructions: "s",
      input: "u",
      sessionId: "joblit:x",
      signal: controller.signal,
    }),
    (error) => error?.code === "RUN_CANCELLED",
  );

  assert.equal(
    calls.filter((call) => call.url.endsWith(`/v1/runs/${runId}/stop`)).length,
    1,
  );
});

test("hermes: stopping remains recoverable across restart without a duplicate run", async () => {
  const runId = "run_" + "6".repeat(32);
  const sessionId = "joblit:stopping-restart";
  const controller = new AbortController();
  const state = new Map();
  let starts = 0;
  const runStateStore = {
    async get(key) {
      return state.get(key) ?? null;
    },
    async set(key, value) {
      state.set(key, value);
    },
    async delete(key) {
      state.delete(key);
    },
  };
  const first = createHermesClient({
    baseUrl: "http://127.0.0.1:8790",
    apiKey: "k",
    runStateStore,
    pollMs: 1,
    fetchImpl: withMissingSession(async (url, init = {}) => {
      if (String(url).endsWith("/v1/runs") && init.method === "POST") {
        starts += 1;
        controller.abort();
        return jsonResponse({ status: "started", run_id: runId });
      }
      if (String(url).endsWith(`/v1/runs/${runId}/stop`)) {
        return jsonResponse({ status: "stopping", run_id: runId });
      }
      return jsonResponse({ error: "unexpected" }, 500);
    }),
  });

  await assert.rejects(
    first.generate({
      instructions: "s",
      input: "u",
      sessionId,
      signal: controller.signal,
    }),
    (error) => error?.code === "RUN_CANCELLED",
  );
  assert.deepEqual(state.get(sessionId), {
    phase: "running",
    runId,
    repairUsed: false,
  });

  let polls = 0;
  const restarted = createHermesClient({
    baseUrl: "http://127.0.0.1:8790",
    apiKey: "k",
    runStateStore,
    pollMs: 1,
    fetchImpl: withMissingSession(async (url, init = {}) => {
      if (String(url).endsWith("/v1/runs") && init.method === "POST") {
        starts += 1;
        return jsonResponse({
          status: "started",
          run_id: "run_" + "0".repeat(32),
        });
      }
      assert.equal(String(url).endsWith(`/v1/runs/${runId}`), true);
      polls += 1;
      return jsonResponse(
        polls === 1
          ? { object: "hermes.run", run_id: runId, status: "stopping" }
          : {
              object: "hermes.run",
              run_id: runId,
              status: "completed",
              output: '{"cvSummary":"settled"}',
            },
      );
    }),
  });

  assert.equal(
    await restarted.generate({
      instructions: "ignored",
      input: "ignored",
      sessionId,
    }),
    '{"cvSummary":"settled"}',
  );
  assert.equal(starts, 1);
  assert.deepEqual(state.get(sessionId), {
    phase: "completed",
    runId,
    repairUsed: false,
  });
});

test("hermes: reconciles an obsolete running operation only after the run is terminal", async () => {
  const runId = "run_" + "3".repeat(32);
  const sessionId = "joblit:obsolete-running";
  const state = new Map([
    [
      sessionId,
      {
        phase: "running",
        runId,
        repairUsed: false,
        operation: TAILORING_OPERATION,
      },
    ],
  ]);
  let polls = 0;
  let stops = 0;
  const hermes = createHermesClient({
    baseUrl: "http://127.0.0.1:8790",
    apiKey: "k",
    timeoutMs: 50,
    pollMs: 1,
    runStateStore: {
      async get(key) {
        return state.get(key) ?? null;
      },
      async set(key, value) {
        state.set(key, structuredClone(value));
      },
      async delete(key) {
        state.delete(key);
      },
    },
    fetchImpl: async (url, init = {}) => {
      if (String(url).endsWith(`/v1/runs/${runId}/stop`)) {
        stops += 1;
        return jsonResponse({ status: "stopping", run_id: runId });
      }
      assert.equal(String(url).endsWith(`/v1/runs/${runId}`), true);
      assert.equal(init.method, undefined);
      polls += 1;
      return jsonResponse({
        object: "hermes.run",
        run_id: runId,
        status: polls === 1 ? "running" : "cancelled",
      });
    },
  });

  assert.deepEqual(await hermes.reconcileObsolete({ sessionId }), {
    cleared: true,
  });
  assert.equal(stops, 1);
  assert.equal(polls, 2);
  assert.equal(state.has(sessionId), false);
});

test("hermes: clears an ambiguous start only after its transcript proves a terminal turn", async () => {
  const sessionId = "joblit:obsolete-starting";
  const input = "generate the accepted resume";
  const starting = {
    phase: "starting",
    repairUsed: false,
    baselineMessageId: 0,
    requestHash: "a".repeat(64),
    inputHash: createHash("sha256").update(input, "utf8").digest("hex"),
    operation: TAILORING_OPERATION,
  };
  const state = new Map([[sessionId, starting]]);
  let transcript = [
    { id: 1, role: "user", content: input },
    {
      id: 2,
      role: "assistant",
      content: '{"cvSummary":"already accepted"}',
      finish_reason: "stop",
    },
  ];
  const hermes = createHermesClient({
    baseUrl: "http://127.0.0.1:8790",
    apiKey: "k",
    runStateStore: {
      async get(key) {
        return state.get(key) ?? null;
      },
      async set(key, value) {
        state.set(key, structuredClone(value));
      },
      async delete(key) {
        state.delete(key);
      },
    },
    fetchImpl: async () =>
      jsonResponse({
        object: "list",
        session_id: sessionId,
        data: transcript,
      }),
  });

  assert.deepEqual(await hermes.reconcileObsolete({ sessionId }), {
    cleared: true,
  });
  assert.equal(state.has(sessionId), false);

  state.set(sessionId, structuredClone(starting));
  transcript = [{ id: 1, role: "user", content: input }];
  await assert.rejects(
    hermes.reconcileObsolete({ sessionId }),
    (error) => error?.code === "RUN_START_UNKNOWN",
  );
  assert.deepEqual(state.get(sessionId), starting);
});

test("hermes: a failed stop keeps the known run recoverable", async () => {
  const runId = "run_" + "1".repeat(32);
  const sessionId = "joblit:stop-unknown";
  const state = new Map();
  const controller = new AbortController();
  const runStateStore = {
    async get(key) {
      return state.get(key) ?? null;
    },
    async set(key, value) {
      state.set(key, value);
    },
  };
  const hermes = createHermesClient({
    baseUrl: "http://127.0.0.1:8790",
    apiKey: "k",
    runStateStore,
    pollMs: 1,
    fetchImpl: withMissingSession(async (url, init = {}) => {
      if (String(url).endsWith("/v1/runs") && init.method === "POST") {
        controller.abort();
        return jsonResponse({ status: "started", run_id: runId });
      }
      if (String(url).endsWith(`/v1/runs/${runId}/stop`)) {
        return jsonResponse({ error: "gateway unavailable" }, 503);
      }
      return jsonResponse({ error: "unexpected" }, 500);
    }),
  });

  await assert.rejects(
    hermes.generate({
      instructions: "s",
      input: "u",
      sessionId,
      signal: controller.signal,
    }),
    (error) => error?.code === "RUN_CANCELLED",
  );
  assert.deepEqual(state.get(sessionId), {
    phase: "running",
    runId,
    repairUsed: false,
  });
});

test("hermes: an invalid successful stop response keeps the run recoverable", async () => {
  const runId = "run_" + "8".repeat(32);
  const sessionId = "joblit:invalid-stop";
  const state = new Map();
  const controller = new AbortController();
  const runStateStore = {
    async get(key) {
      return state.get(key) ?? null;
    },
    async set(key, value) {
      state.set(key, value);
    },
  };
  const hermes = createHermesClient({
    baseUrl: "http://127.0.0.1:8790",
    apiKey: "k",
    runStateStore,
    pollMs: 1,
    fetchImpl: withMissingSession(async (url, init = {}) => {
      if (String(url).endsWith("/v1/runs") && init.method === "POST") {
        controller.abort();
        return jsonResponse({ status: "started", run_id: runId });
      }
      if (String(url).endsWith(`/v1/runs/${runId}/stop`)) {
        return jsonResponse({ status: "ok", run_id: runId });
      }
      return jsonResponse({ error: "unexpected" }, 500);
    }),
  });

  await assert.rejects(
    hermes.generate({
      instructions: "s",
      input: "u",
      sessionId,
      signal: controller.signal,
    }),
    (error) => error?.code === "RUN_CANCELLED",
  );
  assert.deepEqual(state.get(sessionId), {
    phase: "running",
    runId,
    repairUsed: false,
  });
});

test("hermes: resumes a persisted run id without starting a duplicate run", async () => {
  const runId = "run_" + "e".repeat(32);
  const calls = [];
  const state = new Map([
    ["joblit:resume", { phase: "running", runId, repairUsed: false }],
  ]);
  const runStateStore = {
    async get(sessionId) {
      return state.get(sessionId) ?? null;
    },
    async set(sessionId, value) {
      state.set(sessionId, value);
    },
  };
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    assert.equal(init.method, undefined);
    return jsonResponse({
      object: "hermes.run",
      run_id: runId,
      status: "completed",
      output: '{"cvSummary":"recovered"}',
    });
  };
  const hermes = createHermesClient({
    baseUrl: "http://127.0.0.1:8790",
    apiKey: "k",
    fetchImpl,
    pollMs: 1,
    requestTimeoutMs: 5,
    runStateStore,
  });

  const output = await hermes.generate({
    instructions: "must not restart",
    input: "must not restart",
    sessionId: "joblit:resume",
  });

  assert.equal(output, '{"cvSummary":"recovered"}');
  assert.equal(
    calls.some((call) => call.init.method === "POST"),
    false,
  );
  assert.deepEqual(state.get("joblit:resume"), {
    phase: "completed",
    runId,
    repairUsed: false,
  });
});

test("hermes: invalid persisted state fails closed before any network call", async () => {
  let fetchCalls = 0;
  const hermes = createHermesClient({
    baseUrl: "http://127.0.0.1:8790",
    apiKey: "k",
    runStateStore: {
      async get() {
        return { phase: "running", runId: "not-a-run-id", repairUsed: false };
      },
      async set() {
        throw new Error("must not replace invalid state");
      },
    },
    fetchImpl: async () => {
      fetchCalls += 1;
      return jsonResponse({ error: "must not call" }, 500);
    },
  });

  await assert.rejects(
    hermes.generate({
      instructions: "s",
      input: "u",
      sessionId: "joblit:invalid-state",
    }),
    (error) => error?.code === "RUN_STATE_INVALID",
  );
  assert.equal(fetchCalls, 0);
});

test("hermes: persisted repair state rejects plaintext fields before any network call", async () => {
  let fetchCalls = 0;
  const feedback = "Return corrected JSON only.";
  const hermes = createHermesClient({
    baseUrl: "http://127.0.0.1:8790",
    apiKey: "k",
    runStateStore: {
      async get() {
        return {
          phase: "repairing",
          runId: "run_" + "1".repeat(32),
          repairUsed: true,
          feedbackHash: createHash("sha256").update(feedback).digest("hex"),
          baselineMessageId: 7,
          feedback,
        };
      },
      async set() {
        throw new Error("invalid state must not be replaced");
      },
    },
    fetchImpl: async () => {
      fetchCalls += 1;
      return jsonResponse({ error: "must not call" }, 500);
    },
  });

  await assert.rejects(
    hermes.generate({
      instructions: "s",
      input: "u",
      sessionId: "joblit:repair-with-plaintext",
    }),
    (error) => error?.code === "RUN_STATE_INVALID",
  );
  assert.equal(fetchCalls, 0);
});

test("hermes: a persisted starting marker fails closed without blind retry", async () => {
  let fetchCalls = 0;
  const runStateStore = {
    async get() {
      return { phase: "starting", repairUsed: false };
    },
    async set() {
      throw new Error("starting state must remain for operator recovery");
    },
  };
  const hermes = createHermesClient({
    baseUrl: "http://127.0.0.1:8790",
    apiKey: "k",
    fetchImpl: async () => {
      fetchCalls += 1;
      return jsonResponse({ error: "must not retry" }, 500);
    },
    pollMs: 1,
    requestTimeoutMs: 5,
    runStateStore,
  });

  await assert.rejects(
    hermes.generate({
      instructions: "s",
      input: "u",
      sessionId: "joblit:ambiguous",
    }),
    (error) => error?.code === "RUN_START_UNKNOWN",
  );
  assert.equal(fetchCalls, 0);
});

test("hermes: a definitive start rejection clears the starting marker", async () => {
  const sessionId = "joblit:rejected";
  const state = new Map();
  const runStateStore = {
    async get(key) {
      return state.get(key) ?? null;
    },
    async set(key, value) {
      state.set(key, value);
    },
  };
  const hermes = createHermesClient({
    baseUrl: "http://127.0.0.1:8790",
    apiKey: "bad-key",
    fetchImpl: withMissingSession(async () =>
      jsonResponse({ error: "invalid key" }, 401),
    ),
    runStateStore,
  });

  await assert.rejects(
    hermes.generate({ instructions: "s", input: "u", sessionId }),
    (error) => error?.code === "HERMES_HTTP_ERROR" && error?.status === 401,
  );
  assert.deepEqual(state.get(sessionId), {
    phase: "idle",
    repairUsed: false,
  });
});

test("hermes: a transport-ambiguous start is recorded and never retried blindly", async () => {
  const sessionId = "joblit:unknown-start";
  const state = new Map();
  let fetchCalls = 0;
  const runStateStore = {
    async get(key) {
      return state.get(key) ?? null;
    },
    async set(key, value) {
      state.set(key, value);
    },
  };
  const hermes = createHermesClient({
    baseUrl: "http://127.0.0.1:8790",
    apiKey: "k",
    fetchImpl: withMissingSession(async () => {
      fetchCalls += 1;
      throw new TypeError("socket closed after upload");
    }),
    requestTimeoutMs: 5,
    runStateStore,
  });

  await assert.rejects(
    hermes.generate({ instructions: "s", input: "u", sessionId }),
    (error) => error?.code === "RUN_START_UNKNOWN",
  );
  await assert.rejects(
    hermes.generate({ instructions: "s", input: "u", sessionId }),
    (error) => error?.code === "RUN_START_UNKNOWN",
  );
  assert.equal(fetchCalls, 1);
  assert.deepEqual(state.get(sessionId), {
    phase: "starting",
    repairUsed: false,
    baselineMessageId: 0,
    requestHash: createHash("sha256")
      .update(JSON.stringify(["s", "u"]), "utf8")
      .digest("hex"),
    inputHash: createHash("sha256").update("u", "utf8").digest("hex"),
  });
});

test("hermes: recovers an ambiguous start only from one transcript turn after the saved baseline", async () => {
  const sessionId = "joblit:recover-start";
  const state = new Map();
  const requestHash = createHash("sha256")
    .update(JSON.stringify(["system", "user"]), "utf8")
    .digest("hex");
  const inputHash = createHash("sha256").update("user", "utf8").digest("hex");
  let transcript = [
    { id: 4, role: "user", content: "older input" },
    { id: 5, role: "assistant", content: "older output" },
  ];
  let startCalls = 0;
  const runStateStore = {
    async get(key) {
      return state.get(key) ?? null;
    },
    async set(key, value) {
      state.set(key, structuredClone(value));
    },
    async delete(key) {
      state.delete(key);
    },
  };
  const hermes = createHermesClient({
    baseUrl: "http://127.0.0.1:8790",
    apiKey: "k",
    requestTimeoutMs: 5,
    pollMs: 1,
    runStateStore,
    fetchImpl: async (url, init = {}) => {
      if (String(url).includes("/api/sessions/")) {
        return jsonResponse({
          object: "list",
          session_id: sessionId,
          data: transcript,
        });
      }
      if (String(url).endsWith("/v1/runs") && init.method === "POST") {
        startCalls += 1;
        throw new TypeError("connection closed after upload");
      }
      return jsonResponse({ error: "unexpected" }, 500);
    },
  });

  await assert.rejects(
    hermes.generate({ instructions: "system", input: "user", sessionId }),
    (error) => error?.code === "RUN_START_UNKNOWN",
  );
  assert.deepEqual(state.get(sessionId), {
    phase: "starting",
    repairUsed: false,
    baselineMessageId: 5,
    requestHash,
    inputHash,
  });

  transcript = [
    ...transcript,
    { id: 6, role: "user", content: "user" },
    {
      id: 7,
      role: "assistant",
      content: "I will inspect the bounded evidence first.",
      finish_reason: "tool_calls",
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: { name: "inspect", arguments: "{}" },
        },
      ],
    },
    { id: 8, role: "tool", content: "bounded tool result" },
    {
      id: 9,
      role: "assistant",
      content: '{"cvSummary":"recovered"}',
      finish_reason: "stop",
    },
  ];
  assert.equal(
    await hermes.generate({ instructions: "system", input: "user", sessionId }),
    '{"cvSummary":"recovered"}',
  );
  assert.equal(startCalls, 1);
  assert.deepEqual(state.get(sessionId), {
    phase: "completed",
    repairUsed: false,
    baselineMessageId: 5,
    requestHash,
    inputHash,
  });

  await hermes.acknowledge({ sessionId });
  assert.equal(state.has(sessionId), false);
});

test("hermes: transcript recovery rejects observable non-terminal assistant shapes", async () => {
  const input = "user";
  const instructions = "system";
  const requestHash = createHash("sha256")
    .update(JSON.stringify([instructions, input]), "utf8")
    .digest("hex");
  const inputHash = createHash("sha256").update(input, "utf8").digest("hex");
  const candidates = [
    {
      content: "I will call a tool before returning the result.",
      finish_reason: "tool_calls",
      tool_calls: [
        {
          id: "call_pending",
          type: "function",
          function: { name: "inspect", arguments: "{}" },
        },
      ],
    },
    {
      content: '{"cvSummary":"truncated"}',
      finish_reason: "incomplete",
    },
  ];

  for (const [index, candidate] of candidates.entries()) {
    const sessionId = `joblit:non-terminal-${index}`;
    const starting = {
      phase: "starting",
      repairUsed: false,
      baselineMessageId: 0,
      requestHash,
      inputHash,
    };
    const state = new Map([[sessionId, starting]]);
    let postCalls = 0;
    const hermes = createHermesClient({
      baseUrl: "http://127.0.0.1:8790",
      apiKey: "k",
      pollMs: 1,
      requestTimeoutMs: 5,
      runStateStore: {
        async get(key) {
          return state.get(key) ?? null;
        },
        async set(key, value) {
          state.set(key, structuredClone(value));
        },
      },
      fetchImpl: async (_url, init = {}) => {
        if (init.method === "POST") postCalls += 1;
        return jsonResponse({
          object: "list",
          session_id: sessionId,
          data: [
            { id: 1, role: "user", content: input },
            { id: 2, role: "assistant", ...candidate },
          ],
        });
      },
    });

    await assert.rejects(
      hermes.generate({ instructions, input, sessionId }),
      (error) => error?.code === "RUN_START_UNKNOWN",
    );
    assert.equal(postCalls, 0);
    assert.deepEqual(state.get(sessionId), starting);
  }
});

test("hermes: a 5xx start response remains ambiguous and preserves recovery metadata", async () => {
  const sessionId = "joblit:start-gateway-error";
  const state = new Map();
  let startCalls = 0;
  const hermes = createHermesClient({
    baseUrl: "http://127.0.0.1:8790",
    apiKey: "k",
    runStateStore: {
      async get(key) {
        return state.get(key) ?? null;
      },
      async set(key, value) {
        state.set(key, structuredClone(value));
      },
      async delete(key) {
        state.delete(key);
      },
    },
    fetchImpl: withMissingSession(async () => {
      startCalls += 1;
      return jsonResponse(
        { error: { code: "gateway_error", message: "upstream lost reply" } },
        502,
      );
    }),
  });

  await assert.rejects(
    hermes.generate({ instructions: "s", input: "u", sessionId }),
    (error) =>
      error?.code === "RUN_START_UNKNOWN" &&
      error.cause?.code === "HERMES_HTTP_ERROR" &&
      error.cause?.status === 502,
  );
  assert.equal(startCalls, 1);
  assert.equal(state.get(sessionId)?.phase, "starting");
  assert.equal(state.get(sessionId)?.baselineMessageId, 0);
});

test("hermes: a transient transcript preflight error happens before any run starts", async () => {
  const sessionId = "joblit:transcript-preflight-unavailable";
  let startCalls = 0;
  const hermes = createHermesClient({
    baseUrl: "http://127.0.0.1:8790",
    apiKey: "k",
    fetchImpl: async (url, init = {}) => {
      if (String(url).includes("/api/sessions/")) {
        return jsonResponse(
          {
            error: {
              code: "session_db_unavailable",
              message: "Session database unavailable",
            },
          },
          503,
        );
      }
      if (String(url).endsWith("/v1/runs") && init.method === "POST") {
        startCalls += 1;
      }
      return jsonResponse({ error: "unexpected" }, 500);
    },
  });

  await assert.rejects(
    hermes.generate({ instructions: "s", input: "u", sessionId }),
    (error) => error?.code === "HERMES_HTTP_ERROR" && error?.status === 503,
  );
  assert.equal(startCalls, 0);
});

test("hermes: a concurrency-limit rejection clears the reservation for a later retry", async () => {
  const sessionId = "joblit:concurrency-limited";
  const state = new Map();
  let startCalls = 0;
  const hermes = createHermesClient({
    baseUrl: "http://127.0.0.1:8790",
    apiKey: "k",
    runStateStore: {
      async get(key) {
        return state.get(key) ?? null;
      },
      async set(key, value) {
        state.set(key, structuredClone(value));
      },
      async delete(key) {
        state.delete(key);
      },
    },
    fetchImpl: withMissingSession(async (url, init = {}) => {
      if (String(url).endsWith("/v1/runs") && init.method === "POST") {
        startCalls += 1;
        return jsonResponse(
          {
            error: {
              code: "concurrency_limit",
              message: "Too many concurrent runs",
            },
          },
          429,
        );
      }
      return jsonResponse({ error: "unexpected" }, 500);
    }),
  });

  await assert.rejects(
    hermes.generate({ instructions: "s", input: "u", sessionId }),
    (error) => error?.code === "HERMES_HTTP_ERROR" && error?.status === 429,
  );
  assert.equal(startCalls, 1);
  assert.equal(state.has(sessionId), false);
});

test("hermes: records baseline zero for an explicitly missing first session", async () => {
  const sessionId = "joblit:first-session";
  const state = new Map();
  let transcriptReads = 0;
  const hermes = createHermesClient({
    baseUrl: "http://127.0.0.1:8790",
    apiKey: "k",
    runStateStore: {
      async get(key) {
        return state.get(key) ?? null;
      },
      async set(key, value) {
        state.set(key, structuredClone(value));
      },
    },
    fetchImpl: async (url, init = {}) => {
      if (String(url).includes("/api/sessions/")) {
        transcriptReads += 1;
        return jsonResponse(
          { error: { code: "session_not_found", message: "not found" } },
          404,
        );
      }
      if (String(url).endsWith("/v1/runs") && init.method === "POST") {
        throw new TypeError("connection closed after upload");
      }
      return jsonResponse({ error: "unexpected" }, 500);
    },
  });

  await assert.rejects(
    hermes.generate({ instructions: "s", input: "u", sessionId }),
    (error) => error?.code === "RUN_START_UNKNOWN",
  );
  // One read captures the baseline; the second is the fail-closed recovery
  // attempt after the start transport becomes ambiguous.
  assert.equal(transcriptReads, 2);
  assert.equal(state.get(sessionId)?.baselineMessageId, 0);
});

test("hermes: keeps RUN_START_UNKNOWN when the post-baseline transcript has two assistant outputs", async () => {
  const sessionId = "joblit:ambiguous-start-transcript";
  const requestHash = createHash("sha256")
    .update(JSON.stringify(["system", "user"]), "utf8")
    .digest("hex");
  const inputHash = createHash("sha256").update("user", "utf8").digest("hex");
  const state = new Map([
    [
      sessionId,
      {
        phase: "starting",
        repairUsed: false,
        baselineMessageId: 2,
        requestHash,
        inputHash,
      },
    ],
  ]);
  let postCalls = 0;
  const hermes = createHermesClient({
    baseUrl: "http://127.0.0.1:8790",
    apiKey: "k",
    pollMs: 1,
    requestTimeoutMs: 5,
    runStateStore: {
      async get(key) {
        return state.get(key) ?? null;
      },
      async set(key, value) {
        state.set(key, structuredClone(value));
      },
    },
    fetchImpl: async (_url, init = {}) => {
      if (init.method === "POST") postCalls += 1;
      return jsonResponse({
        object: "list",
        session_id: sessionId,
        data: [
          { id: 1, role: "user", content: "old" },
          { id: 2, role: "assistant", content: "old" },
          { id: 3, role: "user", content: "user" },
          { id: 4, role: "assistant", content: "candidate one" },
          { id: 5, role: "assistant", content: "candidate two" },
        ],
      });
    },
  });

  await assert.rejects(
    hermes.generate({ instructions: "system", input: "user", sessionId }),
    (error) => error?.code === "RUN_START_UNKNOWN",
  );
  assert.equal(postCalls, 0);
  assert.equal(state.get(sessionId)?.phase, "starting");
});

test("hermes: two file-backed clients single-flight the same session start", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "joblit-runner-state-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "state.json");
  const sessionId = "joblit:single-flight";
  const runId = "run_" + "e".repeat(32);
  let startCalls = 0;
  let releaseStart;
  const startGate = new Promise((resolve) => {
    releaseStart = resolve;
  });
  const fetchImpl = async (url, init = {}) => {
    if (String(url).endsWith("/v1/runs") && init.method === "POST") {
      startCalls += 1;
      await startGate;
      return jsonResponse({ status: "started", run_id: runId });
    }
    return jsonResponse({
      object: "hermes.run",
      run_id: runId,
      status: "completed",
      output: '{"result":"single"}',
    });
  };
  const first = createHermesClient({
    baseUrl: "http://127.0.0.1:8790",
    apiKey: "k",
    fetchImpl: withMissingSession(fetchImpl),
    pollMs: 1,
    requestTimeoutMs: 500,
    runStateStore: createFileRunStateStore({ filePath }),
  });
  const second = createHermesClient({
    baseUrl: "http://127.0.0.1:8790",
    apiKey: "k",
    fetchImpl: withMissingSession(fetchImpl),
    pollMs: 1,
    requestTimeoutMs: 500,
    runStateStore: createFileRunStateStore({ filePath }),
  });

  const firstResult = first.generate({
    instructions: "system",
    input: "input",
    sessionId,
  });
  while (startCalls === 0) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  const secondResult = second.generate({
    instructions: "system",
    input: "input",
    sessionId,
  });
  releaseStart();

  assert.deepEqual(await Promise.all([firstResult, secondResult]), [
    '{"result":"single"}',
    '{"result":"single"}',
  ]);
  assert.equal(startCalls, 1);
});

test("hermes: repairs at most once through the original session chat", async () => {
  const sessionId = "joblit:repair";
  const feedback = "Return corrected JSON only: cvSummary is required.";
  const calls = [];
  const state = new Map([
    [
      sessionId,
      {
        phase: "completed",
        runId: "run_" + "7".repeat(32),
        repairUsed: false,
        operation: TAILORING_OPERATION,
      },
    ],
  ]);
  const runStateStore = {
    async get(key) {
      return state.get(key) ?? null;
    },
    async set(key, value) {
      state.set(key, value);
    },
  };
  const hermes = createHermesClient({
    baseUrl: "http://127.0.0.1:8790",
    apiKey: "k",
    runStateStore,
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), init });
      if (init.method !== "POST") {
        return jsonResponse({
          object: "list",
          session_id: sessionId,
          data: [
            { id: 41, role: "user", content: "original prompt" },
            { id: 42, role: "assistant", content: '{"cvSummary":"invalid"}' },
          ],
        });
      }
      return jsonResponse({
        object: "hermes.session.chat.completion",
        session_id: sessionId,
        message: {
          role: "assistant",
          content: '{"cvSummary":"repaired"}',
        },
      });
    },
  });

  const repaired = await hermes.repair({
    sessionId,
    feedback,
  });
  assert.equal(repaired, '{"cvSummary":"repaired"}');
  assert.match(calls[0].url, /\/api\/sessions\/joblit%3Arepair\/messages$/);
  assert.equal(calls[0].init.method, undefined);
  assert.match(calls[1].url, /\/api\/sessions\/joblit%3Arepair\/chat$/);
  assert.equal(calls[1].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    message: feedback,
  });
  assert.deepEqual(state.get(sessionId), {
    phase: "repairing",
    runId: "run_" + "7".repeat(32),
    repairUsed: true,
    feedbackHash: createHash("sha256").update(feedback).digest("hex"),
    baselineMessageId: 42,
    operation: TAILORING_OPERATION,
  });

  await assert.rejects(
    hermes.repair({ sessionId, feedback: "try again" }),
    (error) => error?.code === "REPAIR_LIMIT_REACHED",
  );
  assert.equal(calls.length, 2);
});

test("hermes: synchronous repair uses its long-running deadline", async () => {
  const sessionId = "joblit:repair-deadline";
  const feedback = "Return corrected JSON only.";
  const hermes = createHermesClient({
    baseUrl: "http://127.0.0.1:8790",
    apiKey: "k",
    requestTimeoutMs: 5,
    repairTimeoutMs: 100,
    runStateStore: {
      async get() {
        return {
          phase: "completed",
          runId: "run_" + "5".repeat(32),
          repairUsed: false,
        };
      },
      async set() {},
    },
    fetchImpl: async (url, init = {}) => {
      if (String(url).endsWith("/messages")) {
        return jsonResponse({
          object: "list",
          session_id: sessionId,
          data: [
            { id: 1, role: "user", content: "prompt" },
            { id: 2, role: "assistant", content: "{}" },
          ],
        });
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () =>
            resolve(
              jsonResponse({
                object: "hermes.session.chat.completion",
                session_id: sessionId,
                message: { role: "assistant", content: '{"cvSummary":"slow"}' },
              }),
            ),
          25,
        );
        init.signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(new DOMException("aborted", "AbortError"));
          },
          { once: true },
        );
      });
    },
  });

  assert.equal(
    await hermes.repair({ sessionId, feedback }),
    '{"cvSummary":"slow"}',
  );
});

test("hermes: repair rejects a hybrid response with the wrong session id", async () => {
  const sessionId = "joblit:repair-wrong-session";
  const hermes = createHermesClient({
    baseUrl: "http://127.0.0.1:8790",
    apiKey: "k",
    runStateStore: {
      async get() {
        return {
          phase: "completed",
          runId: "run_" + "b".repeat(32),
          repairUsed: false,
        };
      },
      async set() {},
    },
    fetchImpl: async (url, init = {}) => {
      if (String(url).endsWith("/messages")) {
        return jsonResponse({
          object: "list",
          session_id: sessionId,
          data: [
            { id: 1, role: "user", content: "prompt" },
            { id: 2, role: "assistant", content: "{}" },
          ],
        });
      }
      assert.equal(init.method, "POST");
      return jsonResponse({
        object: "hermes.session.chat.completion",
        session_id: "joblit:a-different-session",
        message: { role: "assistant", content: '{"cvSummary":"official"}' },
        role: "assistant",
        content: '{"cvSummary":"hybrid bypass"}',
      });
    },
  });

  await assert.rejects(
    hermes.repair({ sessionId, feedback: "Return corrected JSON only." }),
    (error) => error?.code === "REPAIR_RESPONSE_INVALID",
  );
});

test("hermes: repair remains compatible with the legacy top-level message response", async () => {
  const sessionId = "joblit:repair-legacy";
  const state = new Map([
    [
      sessionId,
      {
        phase: "completed",
        runId: "run_" + "c".repeat(32),
        repairUsed: false,
      },
    ],
  ]);
  const hermes = createHermesClient({
    baseUrl: "http://127.0.0.1:8790",
    apiKey: "k",
    runStateStore: {
      async get(key) {
        return state.get(key) ?? null;
      },
      async set(key, value) {
        state.set(key, value);
      },
    },
    fetchImpl: async (url) =>
      String(url).endsWith("/messages")
        ? jsonResponse({
            object: "list",
            session_id: sessionId,
            data: [
              { id: 1, role: "user", content: "prompt" },
              { id: 2, role: "assistant", content: "{}" },
            ],
          })
        : jsonResponse({
            role: "assistant",
            content: '{"cvSummary":"legacy"}',
          }),
  });

  assert.equal(
    await hermes.repair({
      sessionId,
      feedback: "Return corrected JSON only.",
    }),
    '{"cvSummary":"legacy"}',
  );
});

test("hermes: restart recovers a completed repair from the transcript without another chat", async () => {
  const sessionId = "joblit:repair-restart";
  const runId = "run_" + "4".repeat(32);
  const feedback = "Return corrected JSON only: cvSummary is required.";
  const state = new Map([
    [
      sessionId,
      {
        phase: "repairing",
        runId,
        repairUsed: true,
        feedbackHash: createHash("sha256").update(feedback).digest("hex"),
        baselineMessageId: 52,
      },
    ],
  ]);
  const calls = [];
  const runStateStore = {
    async get(key) {
      return state.get(key) ?? null;
    },
    async set(key, value) {
      state.set(key, value);
    },
    async delete(key) {
      state.delete(key);
    },
  };
  const hermes = createHermesClient({
    baseUrl: "http://127.0.0.1:8790",
    apiKey: "k",
    runStateStore,
    pollMs: 1,
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), init });
      return jsonResponse({
        object: "list",
        session_id: sessionId,
        data: [
          { id: 51, role: "user", content: "original prompt" },
          { id: 52, role: "assistant", content: '{"cvSummary":"invalid"}' },
          { id: 53, role: "user", content: feedback },
          {
            id: 54,
            role: "assistant",
            content: '{"cvSummary":"recovered repair"}',
            finish_reason: "stop",
          },
        ],
      });
    },
  });

  const output = await hermes.generate({
    instructions: "must not restart",
    input: "must not restart",
    sessionId,
  });

  assert.equal(output, '{"cvSummary":"recovered repair"}');
  assert.equal(calls.length, 1);
  assert.match(
    calls[0].url,
    /\/api\/sessions\/joblit%3Arepair-restart\/messages$/,
  );
  assert.equal(calls[0].init.method, undefined);
  assert.deepEqual(state.get(sessionId), {
    phase: "repairing",
    runId,
    repairUsed: true,
    feedbackHash: createHash("sha256").update(feedback).digest("hex"),
    baselineMessageId: 52,
  });

  await hermes.acknowledge({ sessionId });
  assert.equal(state.has(sessionId), false);
});

test("hermes: repair recovery rejects an in-flight stock Hermes tool-call turn", async () => {
  const sessionId = "joblit:repair-tool-in-flight";
  const feedback = "Return corrected JSON only.";
  const repairing = {
    phase: "repairing",
    runId: "run_" + "6".repeat(32),
    repairUsed: true,
    feedbackHash: createHash("sha256").update(feedback).digest("hex"),
    baselineMessageId: 12,
  };
  let postCalls = 0;
  const hermes = createHermesClient({
    baseUrl: "http://127.0.0.1:8790",
    apiKey: "k",
    runStateStore: {
      async get() {
        return repairing;
      },
      async set() {
        throw new Error("in-flight repair state must remain unchanged");
      },
    },
    fetchImpl: async (_url, init = {}) => {
      if (init.method === "POST") postCalls += 1;
      return jsonResponse({
        object: "list",
        session_id: sessionId,
        data: [
          { id: 11, role: "user", content: "original prompt" },
          { id: 12, role: "assistant", content: "invalid" },
          { id: 13, role: "user", content: feedback },
          {
            id: 14,
            role: "assistant",
            content: "I will inspect before returning corrected JSON.",
            finish_reason: "tool_calls",
            tool_calls: [
              {
                id: "call_repair",
                type: "function",
                function: { name: "inspect", arguments: "{}" },
              },
            ],
          },
        ],
      });
    },
  });

  await assert.rejects(
    hermes.generate({
      instructions: "must not restart",
      input: "must not restart",
      sessionId,
    }),
    (error) => error?.code === "REPAIR_OUTCOME_UNKNOWN",
  );
  assert.equal(postCalls, 0);
});

test("hermes: ambiguous repair recovery fails closed without repeating chat", async () => {
  const sessionId = "joblit:repair-ambiguous";
  const feedback = "Return corrected JSON only.";
  let postCalls = 0;
  const hermes = createHermesClient({
    baseUrl: "http://127.0.0.1:8790",
    apiKey: "k",
    runStateStore: {
      async get() {
        return {
          phase: "repairing",
          runId: "run_" + "3".repeat(32),
          repairUsed: true,
          feedbackHash: createHash("sha256").update(feedback).digest("hex"),
          baselineMessageId: 12,
        };
      },
      async set() {
        throw new Error("ambiguous recovery state must remain unchanged");
      },
    },
    fetchImpl: async (_url, init = {}) => {
      if (init.method === "POST") postCalls += 1;
      return jsonResponse({
        object: "list",
        session_id: sessionId,
        data: [
          { id: 11, role: "user", content: "original prompt" },
          { id: 12, role: "assistant", content: '{"cvSummary":"invalid"}' },
          { id: 13, role: "user", content: feedback },
          {
            id: 14,
            role: "assistant",
            content: '{"cvSummary":"candidate one"}',
          },
          {
            id: 15,
            role: "assistant",
            content: '{"cvSummary":"candidate two"}',
          },
        ],
      });
    },
  });

  await assert.rejects(
    hermes.generate({
      instructions: "must not restart",
      input: "must not restart",
      sessionId,
    }),
    (error) => error?.code === "REPAIR_OUTCOME_UNKNOWN",
  );
  assert.equal(postCalls, 0);
});

test("run state store survives a new client instance without exposing secrets", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "joblit-runner-state-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "state.json");
  const first = createFileRunStateStore({ filePath });

  await first.set("joblit:persisted", {
    phase: "running",
    runId: "run_" + "f".repeat(32),
    repairUsed: false,
  });

  const restarted = createFileRunStateStore({ filePath });
  assert.deepEqual(await restarted.get("joblit:persisted"), {
    phase: "running",
    runId: "run_" + "f".repeat(32),
    repairUsed: false,
  });
  const persisted = await readFile(filePath, "utf8");
  assert.doesNotMatch(persisted, /apiKey|instructions|input|modelOutput/i);
});

test("run state store reads v1 state and migrates it in place on write", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "joblit-runner-state-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "state.json");
  const legacy = {
    phase: "running",
    runId: "run_" + "e".repeat(32),
    repairUsed: false,
  };
  await writeFile(
    filePath,
    `${JSON.stringify({
      version: 1,
      sessions: { "joblit:legacy": legacy },
    })}\n`,
    "utf8",
  );
  const store = createFileRunStateStore({ filePath });

  assert.deepEqual(await store.get("joblit:legacy"), legacy);
  await store.set("joblit:new", {
    phase: "starting",
    repairUsed: false,
    baselineMessageId: 0,
    requestHash: "a".repeat(64),
    inputHash: "b".repeat(64),
  });

  const migrated = JSON.parse(await readFile(filePath, "utf8"));
  assert.equal(migrated.version, 2);
  assert.deepEqual(migrated.sessions["joblit:legacy"], legacy);
});

test("run state store persists only opaque repair metadata and rejects model content", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "joblit-runner-state-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "state.json");
  const store = createFileRunStateStore({ filePath });
  const feedback = "This validation feedback must never be persisted.";
  const feedbackHash = createHash("sha256").update(feedback).digest("hex");
  const repairing = {
    phase: "repairing",
    runId: "run_" + "a".repeat(32),
    repairUsed: true,
    feedbackHash,
    baselineMessageId: 91,
  };

  await store.set("joblit:opaque-repair", repairing);
  assert.deepEqual(await store.get("joblit:opaque-repair"), repairing);
  const persisted = await readFile(filePath, "utf8");
  assert.match(persisted, new RegExp(feedbackHash));
  assert.doesNotMatch(persisted, new RegExp(feedback));

  await assert.rejects(
    store.set("joblit:unsafe-repair", {
      ...repairing,
      feedback,
      modelOutput: '{"privateResume":"must not reach disk"}',
    }),
    /unsupported fields/i,
  );
  assert.doesNotMatch(
    await readFile(filePath, "utf8"),
    /privateResume|validation feedback/i,
  );
});

test("run state store lists strict operation identities without persisting prompts or output", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "joblit-runner-state-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "state.json");
  const store = createFileRunStateStore({ filePath });
  const completed = {
    phase: "completed",
    runId: "run_" + "7".repeat(32),
    repairUsed: false,
    operation: TAILORING_OPERATION,
  };

  await store.set("joblit:safe-operation", completed);

  assert.deepEqual(await store.list(), [
    { sessionId: "joblit:safe-operation", state: completed },
  ]);
  const persisted = await readFile(filePath, "utf8");
  assert.match(persisted, new RegExp(TAILORING_OPERATION.promptHash));
  assert.doesNotMatch(
    persisted,
    /instructions|input|feedback|modelOutput|privateResume|job description/i,
  );

  await assert.rejects(
    store.set("joblit:unsafe-operation", {
      ...completed,
      operation: {
        ...TAILORING_OPERATION,
        prompt: "private prompt",
      },
    }),
    /invalid|unsupported/i,
  );
});

test("run state store preserves concurrent writes from independent instances", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "joblit-runner-state-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "state.json");
  const first = createFileRunStateStore({ filePath });
  const second = createFileRunStateStore({ filePath });

  await Promise.all([
    first.set("joblit:first", {
      phase: "running",
      runId: "run_" + "1".repeat(32),
      repairUsed: false,
    }),
    second.set("joblit:second", {
      phase: "running",
      runId: "run_" + "2".repeat(32),
      repairUsed: false,
    }),
  ]);

  const restarted = createFileRunStateStore({ filePath });
  assert.deepEqual(await restarted.get("joblit:first"), {
    phase: "running",
    runId: "run_" + "1".repeat(32),
    repairUsed: false,
  });
  assert.deepEqual(await restarted.get("joblit:second"), {
    phase: "running",
    runId: "run_" + "2".repeat(32),
    repairUsed: false,
  });
});

test("run state store compare-and-set grants one cross-process reservation", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "joblit-runner-state-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "state.json");
  const first = createFileRunStateStore({ filePath });
  const second = createFileRunStateStore({ filePath });
  const starting = { phase: "starting", repairUsed: false };

  const results = await Promise.all([
    first.compareAndSet("joblit:cas", null, starting),
    second.compareAndSet("joblit:cas", null, starting),
  ]);

  assert.deepEqual([...results].sort(), [false, true]);
  assert.deepEqual(await first.get("joblit:cas"), starting);
  assert.equal(
    await second.compareAndSet(
      "joblit:cas",
      { phase: "idle", repairUsed: false },
      null,
    ),
    false,
  );
  assert.equal(await first.compareAndSet("joblit:cas", starting, null), true);
  assert.equal(await second.get("joblit:cas"), null);
});

test("run state store recovers a stale lock left by a crashed process", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "joblit-runner-state-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "state.json");
  const lockPath = `${filePath}.lock`;
  const staleAt = new Date(Date.now() - 60_000);
  await writeFile(
    lockPath,
    JSON.stringify({
      owner: "crashed-runner",
      pid: 2_147_483_647,
      createdAt: staleAt.toISOString(),
    }),
    { mode: 0o600 },
  );
  await utimes(lockPath, staleAt, staleAt);

  const store = createFileRunStateStore({ filePath });
  await store.set("joblit:recovered", {
    phase: "running",
    runId: "run_" + "3".repeat(32),
    repairUsed: false,
  });

  assert.deepEqual(await store.get("joblit:recovered"), {
    phase: "running",
    runId: "run_" + "3".repeat(32),
    repairUsed: false,
  });
});

test("run state store never reaps an old lock owned by a live local process", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "joblit-runner-state-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "state.json");
  const lockPath = `${filePath}.lock`;
  const oldAt = new Date(Date.now() - 60_000);
  await writeFile(
    lockPath,
    JSON.stringify({
      owner: "live-runner",
      pid: process.pid,
      createdAt: oldAt.toISOString(),
    }),
    { mode: 0o600 },
  );
  await utimes(lockPath, oldAt, oldAt);

  const store = createFileRunStateStore({
    filePath,
    lockWaitMs: 50,
    lockRetryMs: 5,
    staleLockMs: 10,
  });
  await assert.rejects(
    store.set("joblit:must-wait", {
      phase: "running",
      runId: "run_" + "4".repeat(32),
      repairUsed: false,
    }),
    /another local Runner/,
  );
  assert.match(await readFile(lockPath, "utf8"), /live-runner/);

  await rm(lockPath);
  await store.set("joblit:retry", {
    phase: "running",
    runId: "run_" + "5".repeat(32),
    repairUsed: false,
  });
  assert.equal((await store.get("joblit:retry"))?.phase, "running");
});

test("joblit: every call carries the bearer token and the error envelope surfaces", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const u = String(url);
    if (u.endsWith("/api/application-batches/active")) {
      return jsonResponse({ batchId: "batch-1", status: "QUEUED" });
    }
    if (u.endsWith("/run-once")) {
      return jsonResponse({
        batch: { id: "batch-1", status: "RUNNING" },
        tasks: [],
        execution: { stopReason: null },
      });
    }
    if (u.endsWith("/api/applications/prompt")) {
      return jsonResponse(
        { error: { code: "NO_PROFILE", message: "Create your resume first" } },
        404,
      );
    }
    return jsonResponse({ error: "unexpected" }, 500);
  };

  const joblit = createJoblitClient({
    baseUrl: "https://joblit.example.com",
    token: AGENT_TOKEN,
    fetchImpl,
  });

  const active = await joblit.activeBatch();
  assert.equal(active.batchId, "batch-1");

  await joblit.runOnce("batch-1", { completedTasks: [] });
  const runOnceCall = calls.find((c) => c.url.endsWith("/run-once"));
  assert.equal(runOnceCall.init.headers.Authorization, `Bearer ${AGENT_TOKEN}`);
  assert.deepEqual(JSON.parse(runOnceCall.init.body), {
    maxSteps: 1,
    completedTasks: [],
  });

  // The server's own message travels — not a status code.
  await assert.rejects(
    joblit.prompt({ jobId: "j", target: "resume" }),
    (error) =>
      error?.code === "NO_PROFILE" &&
      /Create your resume first/.test(error.message),
  );
});

test("joblit: fit queue calls hit the fit endpoints with the bearer token", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return jsonResponse({ ok: true });
  };

  const joblit = createJoblitClient({
    baseUrl: "https://joblit.example.com",
    token: AGENT_TOKEN,
    fetchImpl,
  });

  await joblit.nextFitBatch();
  await joblit.fitPrompt({ jobIds: ["job-1"] });
  await joblit.heartbeatFitClaim({
    claimId: "55555555-5555-4555-8555-555555555555",
    attemptId: "44444444-4444-4444-8444-444444444444",
  });
  await joblit.importFitBatch({
    jobIds: ["job-1"],
    claimToken: "c",
    modelOutput: "[]",
  });
  await joblit.fitSettlement("d".repeat(64));
  await joblit.markFitFailed({ jobIds: ["job-1"], claimToken: "c" });
  await joblit.releaseFitBatch({ jobIds: ["job-1"], claimToken: "c" });

  assert.deepEqual(
    calls.map((c) => c.url.replace("https://joblit.example.com", "")),
    [
      "/api/jobs/fit/next-batch",
      "/api/jobs/fit/prompt",
      "/api/jobs/fit/heartbeat",
      "/api/jobs/fit/batch-import",
      "/api/jobs/fit/settlement-status",
      "/api/jobs/fit/mark-failed",
      "/api/jobs/fit/release-batch",
    ],
  );
  for (const call of calls) {
    assert.equal(call.init.method, "POST");
    assert.equal(call.init.headers.Authorization, `Bearer ${AGENT_TOKEN}`);
  }
  assert.deepEqual(JSON.parse(calls[1].init.body), { jobIds: ["job-1"] });
  assert.deepEqual(JSON.parse(calls[2].init.body), {
    claimId: "55555555-5555-4555-8555-555555555555",
    attemptId: "44444444-4444-4444-8444-444444444444",
  });
  assert.deepEqual(JSON.parse(calls[4].init.body), {
    issueKey: "d".repeat(64),
  });
});

test("joblit: import treats any 2xx as settled, including a PDF body", async () => {
  const fetchImpl = async (url, init = {}) => {
    if (String(url).includes("/api/applications/manual-generate")) {
      assert.match(String(url), /finalize=true/);
      assert.equal(init.headers.Authorization, `Bearer ${AGENT_TOKEN}`);
      return new Response(new Blob(["%PDF-1.7"], { type: "application/pdf" }), {
        status: 200,
        headers: { "content-type": "application/pdf" },
      });
    }
    return jsonResponse({ error: "unexpected" }, 500);
  };

  const joblit = createJoblitClient({
    baseUrl: "https://joblit.example.com",
    token: AGENT_TOKEN,
    fetchImpl,
  });

  await joblit.importGeneration({
    jobId: "j",
    target: "resume",
    source: "codex_batch",
    modelOutput: "{}",
    promptMeta: {},
  });
});

test("joblit: gives the import call a render-sized budget, not the API default", async () => {
  // The import route compiles LaTeX through an external renderer that alone
  // is allowed 20s. With the generic request budget the client timed out
  // while the server went on to succeed — every slow render became an
  // "unknown settlement" replayed into the same wall. Proof by contrast: a
  // response slower than the general budget must still be awaited here.
  const joblit = createJoblitClient({
    baseUrl: "https://joblit.example.com",
    token: AGENT_TOKEN,
    requestTimeoutMs: 100,
    fetchImpl: async (url, init = {}) =>
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve(jsonResponse({ ok: true })), 300);
        init.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new Error("aborted by client budget"));
        });
      }),
  });

  await assert.doesNotReject(
    joblit.importGeneration({
      jobId: "j",
      target: "cover",
      source: "codex_batch",
      modelOutput: "{}",
      promptMeta: {},
    }),
  );
});

test("joblit: reads TailoringRun status for cooperative server cancellation", async () => {
  const runId = "55555555-5555-4555-8555-555555555555";
  const calls = [];
  const joblit = createJoblitClient({
    baseUrl: "https://joblit.example.com",
    token: AGENT_TOKEN,
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), init });
      return jsonResponse({ run: { id: runId, status: "RUNNING" } });
    },
  });

  await assert.doesNotReject(joblit.tailoringRunStatus(runId));
  assert.equal(
    calls[0].url,
    `https://joblit.example.com/api/tailoring-runs/${runId}`,
  );
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${AGENT_TOKEN}`);
  assert.equal(calls[0].init.method, undefined);
});

test("joblit: refuses insecure remote URLs and legacy bearer formats", () => {
  assert.throws(
    () =>
      createJoblitClient({
        baseUrl: "http://joblit.example.com",
        token: AGENT_TOKEN,
      }),
    /https/i,
  );
  assert.throws(
    () =>
      createJoblitClient({
        baseUrl: "https://joblit.example.com",
        token: `jfext_${"b".repeat(64)}`,
      }),
    /AgentCredential/i,
  );
  assert.doesNotThrow(() =>
    createJoblitClient({
      baseUrl: "http://127.0.0.1:3000",
      token: AGENT_TOKEN,
    }),
  );
});

test("joblit: aborts a request that exceeds its network deadline", async () => {
  const joblit = createJoblitClient({
    baseUrl: "https://joblit.example.com",
    token: AGENT_TOKEN,
    requestTimeoutMs: 10,
    fetchImpl: withMissingSession(
      async (_url, init = {}) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        }),
    ),
  });

  await assert.rejects(
    joblit.activeBatch(),
    (error) => error?.code === "JOBLIT_REQUEST_TIMEOUT",
  );
});

test("joblit: classifies an unconfirmed network outcome as a transport error", async () => {
  const cause = new TypeError("socket disconnected");
  const joblit = createJoblitClient({
    baseUrl: "https://joblit.example.com",
    token: AGENT_TOKEN,
    fetchImpl: async () => {
      throw cause;
    },
  });

  await assert.rejects(
    joblit.activeBatch(),
    (error) =>
      error?.code === "JOBLIT_TRANSPORT_ERROR" &&
      error?.cause === cause &&
      /could not be confirmed/i.test(error.message),
  );
});

test("hermes: a start request timeout stays fail-closed as an unknown start", async () => {
  const state = new Map();
  const sessionId = "joblit:start-timeout";
  const hermes = createHermesClient({
    baseUrl: "http://127.0.0.1:8790",
    apiKey: "k",
    requestTimeoutMs: 10,
    runStateStore: {
      async get(key) {
        return state.get(key) ?? null;
      },
      async set(key, value) {
        state.set(key, value);
      },
    },
    fetchImpl: withMissingSession(
      async (_url, init = {}) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        }),
    ),
  });

  await assert.rejects(
    hermes.generate({ instructions: "s", input: "u", sessionId }),
    (error) =>
      error?.code === "RUN_START_UNKNOWN" &&
      error?.cause?.code === "HERMES_REQUEST_TIMEOUT",
  );
  assert.deepEqual(state.get(sessionId), {
    phase: "starting",
    repairUsed: false,
    baselineMessageId: 0,
    requestHash: createHash("sha256")
      .update(JSON.stringify(["s", "u"]), "utf8")
      .digest("hex"),
    inputHash: createHash("sha256").update("u", "utf8").digest("hex"),
  });
});
