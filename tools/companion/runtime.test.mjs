import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { createCompanion, parseActivation } from './runtime.mjs';
import { createStorage } from './storage.mjs';

const origin = 'https://www.joblit.tech';
const account = 'a'.repeat(64);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const response = (body, status = 200) => new Response(JSON.stringify(body), { status });
async function waitFor(check) {
  for (let attempt = 0; attempt < 100; attempt++) { const value = await check(); if (value) return value; await sleep(10); }
  throw new Error('Condition did not become true.');
}
const payload = taskId => ({ taskId, jobId: 'job-1', target: 'resume', capability: 'scoped-capability-'.repeat(3), apiOrigin: origin, prompt: { instructions: 'Return JSON only.', input: 'Fictional resume.' }, expiresAt: new Date(Date.now() + 60_000).toISOString() });

async function fixture(t, options = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'joblit-companion-test-'));
  const calls = [];
  const hermes = options.hermes || { status: async () => ({ runtime: { state: 'ready' }, auth: { state: 'ready' } }), generate: async () => '{"summary":"sample"}', startAuth: async () => ({ auth: { state: 'authenticating' } }), close() {} };
  const remote = options.fetchImpl || (async (url, request) => {
    calls.push({ url, request });
    if (url.endsWith('/result')) return response({ status: 'completed', applicationId: 'app-1', resumePdfUrl: 'https://example.com/sample.pdf' });
    if (url.endsWith('/cancel')) return response({ status: 'cancelled' });
    if (url.endsWith('/failure')) return response({ status: 'failed' });
    return response({ status: 'pending' });
  });
  const runtime = await createCompanion({ dataDir, port: 0, hermes, fetchImpl: remote, retryDelay: 5, now: options.now });
  const address = await runtime.listen();
  t.after(async () => { await runtime.close(); await rm(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${address.port}`;
  const request = async (path, { method = 'GET', body, token, requestOrigin = origin, host } = {}) => {
    if (host) return new Promise((resolve, reject) => {
      const request = httpRequest(`${base}${path}`, { method, headers: { Host: host, Origin: requestOrigin } }, response => {
        let content = ''; response.on('data', chunk => { content += chunk; });
        response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(content) }));
      });
      request.on('error', reject); request.end();
    });
    const res = await fetch(`${base}${path}`, { method, headers: { ...(requestOrigin ? { Origin: requestOrigin } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(host ? { Host: host } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: res.status === 204 ? null : await res.json() };
  };
  const pair = async (pairedAccount = account, pairedOrigin = origin) => {
    const challenge = randomBytes(32).toString('hex');
    runtime.activate({ origin: pairedOrigin, account: pairedAccount, challenge });
    const result = await request('/pair', { method: 'POST', body: { challenge, account: pairedAccount }, requestOrigin: pairedOrigin });
    assert.equal(result.status, 200);
    return result.body.token;
  };
  return { runtime, dataDir, calls, request, pair };
}

test('activation rejects command-bearing, malformed and foreign origin URIs', () => {
  const query = new URLSearchParams({ origin, account, challenge: '1'.repeat(64) });
  assert.deepEqual(parseActivation(`joblit://connect?${query}`), { origin, account, challenge: '1'.repeat(64) });
  for (const uri of [`joblit://connect?${query}&command=calc`, `joblit://connect/run?${query}`, `https://connect?${query}`, `joblit://connect?${query}&account=${account}`, `joblit://connect?${new URLSearchParams({ origin: 'https://evil.test', account, challenge: '1'.repeat(64) })}`]) assert.throws(() => parseActivation(uri));
});

test('enforces Host, Origin, one-time pairing and origin/account isolation', async t => {
  const { runtime, request, pair } = await fixture(t);
  assert.equal((await request('/health', { requestOrigin: null })).status, 403);
  assert.equal((await request('/health', { requestOrigin: 'https://evil.test' })).status, 403);
  assert.equal((await request('/health', { host: 'evil.test' })).status, 403);
  assert.equal((await request('/health')).body.protocolVersion, 1);
  const challenge = '2'.repeat(64);
  runtime.activate({ origin, account, challenge });
  assert.equal((await request('/pair', { method: 'POST', body: { challenge, account: 'b'.repeat(64) } })).status, 403);
  const paired = await request('/pair', { method: 'POST', body: { challenge, account } });
  assert.equal(paired.status, 200);
  assert.equal((await request('/pair', { method: 'POST', body: { challenge, account } })).status, 403);
  assert.equal((await request('/status', { token: paired.body.token, requestOrigin: 'https://joblit.tech' })).status, 401);
  assert.equal((await request('/status', { token: paired.body.token })).body.auth.state, 'ready');
  const other = await pair('b'.repeat(64));
  const submitted = await request('/tasks', { method: 'POST', token: paired.body.token, body: payload('isolated-task') });
  assert.equal(submitted.status, 202);
  assert.equal((await request('/tasks/isolated-task', { token: other })).status, 404);
  assert.deepEqual((await request('/tasks', { token: other })).body.tasks, []);
});

test('runs one model at a time, remains responsive and makes duplicate submission idempotent', async t => {
  let release;
  let runs = 0;
  const hermes = { status: async () => ({ runtime: { state: 'ready' }, auth: { state: 'ready' } }), generate: async () => { runs++; if (runs === 1) return new Promise(resolve => { release = resolve; }); return 'second'; }, close() {} };
  const { request, pair, calls, dataDir } = await fixture(t, { hermes });
  const token = await pair();
  const first = payload('first');
  assert.equal((await request('/tasks', { method: 'POST', token, body: first })).status, 202);
  await waitFor(() => release);
  assert.equal((await request('/tasks', { method: 'POST', token, body: first })).status, 200);
  assert.equal((await request('/tasks', { method: 'POST', token, body: payload('second') })).status, 202);
  assert.equal((await request('/health')).status, 200);
  assert.equal(runs, 1);
  const visible = (await request('/tasks', { token })).body;
  assert.equal(JSON.stringify(visible).includes(first.capability), false);
  assert.equal(JSON.stringify(visible).includes(first.prompt.input), false);
  release('first-result');
  await waitFor(async () => (await request('/tasks/second', { token })).body.task.status === 'completed');
  assert.equal(runs, 2);
  const storage = await createStorage(dataDir);
  const stored = (await storage.readTasks()).find(task => task.taskId === 'first');
  for (const key of ['prompt', 'capability', 'submission']) assert.equal(key in stored, false);
  assert.equal((await request('/tasks', { method: 'POST', token, body: first })).status, 200);
  assert.equal(runs, 2);
  for (const call of calls) {
    assert.ok(call.url.startsWith(`${origin}/api/local-tailoring/tasks/`));
    assert.equal(call.request.headers.Authorization, `Bearer ${first.capability}`);
    assert.equal(call.request.redirect, 'error');
  }
});

test('retries the same persisted output after a transport failure without another model call', async t => {
  let generations = 0;
  const outputs = [];
  const hermes = { status: async () => ({ runtime: { state: 'ready' }, auth: { state: 'ready' } }), generate: async () => { generations++; return 'durable-output'; }, close() {} };
  const { request, pair } = await fixture(t, { hermes, fetchImpl: async (url, request) => {
    if (url.endsWith('/result')) { outputs.push(request.body); if (outputs.length === 1) throw new Error('offline'); return response({ status: 'completed', applicationId: 'app-1' }); }
    return response({ status: 'pending' });
  } });
  const token = await pair();
  await request('/tasks', { method: 'POST', token, body: payload('retry') });
  await waitFor(async () => (await request('/tasks/retry', { token })).body.task.status === 'completed');
  assert.equal(generations, 1);
  assert.equal(outputs.length, 2);
  assert.equal(outputs[0], outputs[1]);
});

test('a persistently unavailable publisher backs off without blocking another model task', async t => {
  const outputs = [];
  let available = false;
  let generations = 0;
  const clock = Date.now();
  const hermes = { status: async () => ({ auth: { state: 'ready' } }), generate: async () => `generated-once-${++generations}`, close() {} };
  const { request, pair, dataDir } = await fixture(t, { hermes, now: () => clock, fetchImpl: async (url, request) => {
    if (url.endsWith('/blocked/result')) {
      outputs.push(request.body);
      return response(available ? { status: 'completed', applicationId: 'recovered' } : { code: 'LATEX_RENDER_CONFIG_MISSING', message: 'The renderer is unavailable.' }, available ? 200 : 503);
    }
    return response(url.endsWith('/result') ? { status: 'completed', applicationId: 'next-job' } : { status: 'pending' });
  } });
  const token = await pair();
  await request('/tasks', { method: 'POST', token, body: payload('blocked') });
  await waitFor(() => outputs.length >= 3);
  const storage = await createStorage(dataDir);
  const waiting = await waitFor(async () => { const task = (await storage.readTasks()).find(task => task.taskId === 'blocked'); return task.publishRetryCount >= 3 && task; });
  assert.equal(waiting.status, 'publishing');
  assert.equal(waiting.submission.rawOutput, 'generated-once-1');
  assert.ok(waiting.nextRetryAt - Date.parse(waiting.updatedAt) >= 20);
  await request('/tasks', { method: 'POST', token, body: { ...payload('other-job'), jobId: 'job-2' } });
  await waitFor(async () => (await request('/tasks/other-job', { token })).body.task.status === 'completed');
  assert.equal(generations, 2);
  assert.equal((await request('/tasks/blocked', { token })).body.task.status, 'publishing');
  available = true;
  await waitFor(async () => (await request('/tasks/blocked', { token })).body.task.status === 'completed');
  assert.equal(generations, 2);
  assert.ok(outputs.length >= 4);
  assert.equal(new Set(outputs).size, 1);
});

test('stops on a repeated repair code instead of spending all attempts', async t => {
  let generations = 0;
  const hermes = { status: async () => ({ runtime: { state: 'ready' }, auth: { state: 'ready' } }), generate: async () => { generations++; return 'rejected'; }, close() {} };
  const { request, pair } = await fixture(t, { hermes, fetchImpl: async url => response(url.endsWith('/result') ? { status: 'repair', code: 'BAD_SKILL', message: 'Use existing skills only.' } : { status: 'pending' }) });
  const token = await pair();
  await request('/tasks', { method: 'POST', token, body: payload('repair') });
  const task = await waitFor(async () => { const task = (await request('/tasks/repair', { token })).body.task; return task.status === 'failed' && task; });
  assert.equal(generations, 2);
  assert.equal(task.error.code, 'BAD_SKILL');
});

test('cancels the live model and prevents any result publication', async t => {
  let aborted = false;
  let started = false;
  const hermes = { status: async () => ({ runtime: { state: 'ready' }, auth: { state: 'ready' } }), generate: (_prompt, { signal }) => new Promise((_resolve, reject) => { started = true; signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); }, { once: true }); }), close() {} };
  const { request, pair, calls } = await fixture(t, { hermes });
  const token = await pair();
  await request('/tasks', { method: 'POST', token, body: payload('cancel-me') });
  await waitFor(() => started);
  const cancelled = await request('/tasks/cancel-me/cancel', { method: 'POST', token, body: {} });
  assert.ok(['cancelling', 'cancelled'].includes(cancelled.body.task.status));
  await waitFor(async () => (await request('/tasks/cancel-me', { token })).body.task.status === 'cancelled');
  assert.equal(aborted, true);
  assert.equal(calls.some(call => call.url.endsWith('/result')), false);
});

test('refuses mismatched API origins and reports interrupted work without regenerating', async t => {
  const { runtime, request, pair, dataDir } = await fixture(t);
  const token = await pair();
  assert.equal((await request('/tasks', { method: 'POST', token, body: { ...payload('wrong-origin'), apiOrigin: 'http://localhost:3000' } })).status, 400);
  const storage = await createStorage(dataDir);
  await storage.saveTask({ ...payload('interrupted'), account, status: 'running', attempt: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  await runtime.close();
  const calls = [];
  const restarted = await createCompanion({ dataDir, port: 0, hermes: { close() {}, generate() { throw new Error('must not run'); } }, fetchImpl: async url => { calls.push(url); return response({ status: 'failed' }); } });
  await restarted.listen();
  await waitFor(async () => !(await storage.readTasks()).find(task => task.taskId === 'interrupted').failurePending);
  await restarted.close();
  const stored = (await storage.readTasks()).find(task => task.taskId === 'interrupted');
  assert.equal(stored.status, 'failed');
  assert.equal(stored.error.code, 'COMPANION_RESTARTED');
  assert.deepEqual(calls, [`${origin}/api/local-tailoring/tasks/interrupted/failure`]);
  for (const key of ['prompt', 'capability', 'submission']) assert.equal(key in stored, false);
});

test('keeps cancellation pending offline and accepts an already completed publication', async t => {
  let publishing = false;
  let online = false;
  let generations = 0;
  const hermes = { status: async () => ({ auth: { state: 'ready' } }), generate: async () => { generations++; return 'already-sent-output'; }, close() {} };
  const { request, pair, dataDir } = await fixture(t, { hermes, fetchImpl: async (url, request) => {
    if (url.endsWith('/result')) {
      publishing = true;
      return new Promise((_resolve, reject) => request.signal.addEventListener('abort', () => reject(new Error('response lost')), { once: true }));
    }
    if (publishing && !online) throw new Error('offline');
    return response(publishing ? { status: 'completed', result: { applicationId: 'published-despite-disconnect' } } : { status: 'pending' });
  } });
  const token = await pair();
  await request('/tasks', { method: 'POST', token, body: payload('cancel-race') });
  await waitFor(() => publishing);
  const cancelled = await request('/tasks/cancel-race/cancel', { method: 'POST', token, body: {} });
  assert.equal(cancelled.status, 202);
  assert.equal(cancelled.body.task.status, 'cancelling');
  await sleep(40);
  assert.equal((await request('/tasks/cancel-race', { token })).body.task.status, 'cancelling');
  online = true;
  const completed = await waitFor(async () => { const task = (await request('/tasks/cancel-race', { token })).body.task; return task.status === 'completed' && task; });
  assert.equal(completed.result.applicationId, 'published-despite-disconnect');
  assert.equal(generations, 1);
  const storage = await createStorage(dataDir);
  const stored = await waitFor(async () => { const task = (await storage.readTasks())[0]; return task.status === 'completed' && task; });
  for (const key of ['prompt', 'capability', 'submission', 'cancelRequested']) assert.equal(key in stored, false);
});

test('restart replays a durable response exactly without checking auth or calling a model', async t => {
  const { runtime, dataDir } = await fixture(t);
  await runtime.close();
  const storage = await createStorage(dataDir);
  const submission = { rawOutput: 'durable-private-response', attempt: 2 };
  await storage.saveTask({ ...payload('recover-output'), account, status: 'publishing', attempt: 2, submission, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  const sent = [];
  const restarted = await createCompanion({ dataDir, port: 0, retryDelay: 5, hermes: { close() {}, status() { throw new Error('must not check auth'); }, generate() { throw new Error('must not generate'); } }, fetchImpl: async (url, request) => {
    if (url.endsWith('/result')) { sent.push(JSON.parse(request.body)); if (sent.length === 1) throw new Error('offline at restart'); return response({ status: 'completed', applicationId: 'recovered' }); }
    return response({ status: 'publishing' });
  } });
  t.after(() => restarted.close());
  await restarted.listen();
  const stored = await waitFor(async () => { const task = (await storage.readTasks())[0]; return task.status === 'completed' && task; });
  assert.deepEqual(sent, [submission, submission]);
  assert.equal(stored.result.applicationId, 'recovered');
  for (const key of ['prompt', 'capability', 'submission', 'resumeSubmission']) assert.equal(key in stored, false);
  await restarted.close();
});

test('restart never buys a repair attempt after replaying a rejected durable response', async t => {
  const { runtime, dataDir } = await fixture(t);
  await runtime.close();
  const storage = await createStorage(dataDir);
  await storage.saveTask({ ...payload('recover-repair'), account, status: 'publishing', attempt: 1, submission: { rawOutput: 'needs-repair', attempt: 1 }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  const calls = [];
  const restarted = await createCompanion({ dataDir, port: 0, hermes: { close() {}, generate() { throw new Error('must not generate'); } }, fetchImpl: async url => {
    calls.push(url);
    return response({ status: url.endsWith('/result') ? 'repair' : url.endsWith('/failure') ? 'failed' : 'publishing', code: 'BAD_SKILL' });
  } });
  t.after(() => restarted.close());
  await restarted.listen();
  const stored = await waitFor(async () => { const task = (await storage.readTasks())[0]; return task.status === 'failed' && !task.failurePending && task; });
  assert.equal(stored.error.code, 'RESTART_REQUIRES_GENERATION');
  assert.equal(calls.filter(url => url.endsWith('/result')).length, 1);
  assert.equal(calls.filter(url => url.endsWith('/failure')).length, 1);
  await restarted.close();
});

test('restart resumes a pending cancellation instead of submitting its saved output', async t => {
  const { runtime, dataDir } = await fixture(t);
  await runtime.close();
  const storage = await createStorage(dataDir);
  await storage.saveTask({ ...payload('recover-cancel'), account, status: 'cancelling', cancelRequested: true, attempt: 1, submission: { rawOutput: 'do-not-submit', attempt: 1 }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  const calls = [];
  const restarted = await createCompanion({ dataDir, port: 0, hermes: { close() {}, generate() { throw new Error('must not generate'); } }, fetchImpl: async url => { calls.push(url); return response({ status: 'cancelled' }); } });
  t.after(() => restarted.close());
  await restarted.listen();
  await waitFor(async () => (await storage.readTasks())[0].status === 'cancelled');
  assert.deepEqual(calls, [`${origin}/api/local-tailoring/tasks/recover-cancel/cancel`]);
  await restarted.close();
});
