import assert from "node:assert/strict";
import test from "node:test";

import { createHermesClient } from "./hermesClient.mjs";
import { createJoblitClient } from "./joblitClient.mjs";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("hermes: starts a run, polls to completion, returns the output", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/v1/runs") && init.method === "POST") {
      return jsonResponse({ status: "started", run_id: "run_" + "a".repeat(32) });
    }
    if (String(url).includes("/v1/runs/run_")) {
      // First poll still running, second completed.
      const polls = calls.filter((c) => c.init.method !== "POST").length;
      return jsonResponse(
        polls < 2
          ? { object: "hermes.run", run_id: "run_" + "a".repeat(32), status: "running" }
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
    fetchImpl,
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

test("hermes: a failed run surfaces the gateway's error", async () => {
  const fetchImpl = async (url, init = {}) => {
    if (init.method === "POST") {
      return jsonResponse({ status: "started", run_id: "run_" + "b".repeat(32) });
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
    fetchImpl,
    pollMs: 1,
  });

  await assert.rejects(
    hermes.generate({ instructions: "s", input: "u", sessionId: "joblit:x" }),
    /model exploded/,
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
      return jsonResponse({ status: "started", run_id: "run_" + "c".repeat(32) });
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
    fetchImpl,
    pollMs: 1,
    timeoutMs: 20,
  });

  await assert.rejects(
    hermes.generate({ instructions: "s", input: "u", sessionId: "joblit:x" }),
    /timed out/i,
  );
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
      return jsonResponse({ batch: { id: "batch-1", status: "RUNNING" }, tasks: [], execution: { stopReason: null } });
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
    token: "agent-token",
    fetchImpl,
  });

  const active = await joblit.activeBatch();
  assert.equal(active.batchId, "batch-1");

  await joblit.runOnce("batch-1", { completedTasks: [] });
  const runOnceCall = calls.find((c) => c.url.endsWith("/run-once"));
  assert.equal(runOnceCall.init.headers.Authorization, "Bearer agent-token");
  assert.deepEqual(JSON.parse(runOnceCall.init.body), {
    maxSteps: 1,
    completedTasks: [],
  });

  // The server's own message travels — not a status code.
  await assert.rejects(
    joblit.prompt({ jobId: "j", target: "resume" }),
    /Create your resume first/,
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
    token: "agent-token",
    fetchImpl,
  });

  await joblit.nextFitBatch();
  await joblit.fitPrompt({ jobIds: ["job-1"] });
  await joblit.importFitBatch({ jobIds: ["job-1"], claimToken: "c", modelOutput: "[]" });
  await joblit.markFitFailed({ jobIds: ["job-1"], claimToken: "c" });
  await joblit.releaseFitBatch({ jobIds: ["job-1"], claimToken: "c" });

  assert.deepEqual(
    calls.map((c) => c.url.replace("https://joblit.example.com", "")),
    [
      "/api/jobs/fit/next-batch",
      "/api/jobs/fit/prompt",
      "/api/jobs/fit/batch-import",
      "/api/jobs/fit/mark-failed",
      "/api/jobs/fit/release-batch",
    ],
  );
  for (const call of calls) {
    assert.equal(call.init.method, "POST");
    assert.equal(call.init.headers.Authorization, "Bearer agent-token");
  }
  assert.deepEqual(JSON.parse(calls[1].init.body), { jobIds: ["job-1"] });
});

test("joblit: import treats any 2xx as settled, including a PDF body", async () => {
  const fetchImpl = async (url, init = {}) => {
    if (String(url).includes("/api/applications/manual-generate")) {
      assert.match(String(url), /finalize=true/);
      assert.equal(init.headers.Authorization, "Bearer agent-token");
      return new Response(new Blob(["%PDF-1.7"], { type: "application/pdf" }), {
        status: 200,
        headers: { "content-type": "application/pdf" },
      });
    }
    return jsonResponse({ error: "unexpected" }, 500);
  };

  const joblit = createJoblitClient({
    baseUrl: "https://joblit.example.com",
    token: "agent-token",
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
