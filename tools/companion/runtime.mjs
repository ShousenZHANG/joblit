import { createServer } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createStorage, installationSecret } from './storage.mjs';
import { createHermes } from './hermes.mjs';

export const PROTOCOL_VERSION = 1;
export const ALLOWED_ORIGINS = new Set(['https://www.joblit.tech', 'https://joblit.tech', 'http://localhost:3000', 'http://127.0.0.1:3000']);
const hash = value => createHash('sha256').update(value).digest('hex');
const terminal = new Set(['completed', 'failed', 'cancelled']);
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const validAccount = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const problem = (status, code, message) => Object.assign(new Error(message), { status, code });
const pause = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(problem(409, 'CANCELLED', 'The task was cancelled.'));
  const abort = () => { clearTimeout(timer); reject(problem(409, 'CANCELLED', 'The task was cancelled.')); };
  const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
  signal?.addEventListener('abort', abort, { once: true });
});

export function parseActivation(uri) {
  let url;
  try { url = new URL(uri); } catch { throw problem(400, 'INVALID_ACTIVATION', 'The connection link is invalid.'); }
  const keys = [...url.searchParams.keys()];
  const activation = Object.fromEntries(url.searchParams);
  if (url.protocol !== 'joblit:' || url.hostname !== 'connect' || !['', '/'].includes(url.pathname) || url.username || url.password || url.port || url.hash || keys.length !== 3 || new Set(keys).size !== 3 || !ALLOWED_ORIGINS.has(activation.origin) || !/^[a-f0-9]{64}$/.test(activation.challenge || '') || !validAccount(activation.account)) {
    throw problem(400, 'INVALID_ACTIVATION', 'The connection link is invalid.');
  }
  return activation;
}

async function readBody(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] || '')) throw problem(415, 'JSON_REQUIRED', 'Send a JSON request.');
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) throw problem(413, 'REQUEST_TOO_LARGE', 'The request is too large.');
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch { throw problem(400, 'INVALID_JSON', 'The request is not valid JSON.'); }
}

function publicTask(task) {
  return Object.fromEntries(Object.entries({ taskId: task.taskId, jobId: task.jobId, target: task.target, status: task.status, attempt: task.attempt, createdAt: task.createdAt, updatedAt: task.updatedAt, error: task.error, result: task.result }).filter(([, value]) => value !== undefined));
}

function safeResult(value) {
  const result = {};
  for (const key of ['applicationId', 'aiContentHash', 'publication', 'resumePdfUrl', 'resumePdfName', 'coverPdfUrl', 'coverPdfName']) {
    if (value[key] !== undefined) result[key] = value[key];
  }
  return result;
}

export async function createCompanion({ dataDir, port = 8791, hermes = createHermes(), fetchImpl = fetch, now = Date.now, retryDelay = 3000 } = {}) {
  const secret = await installationSecret(dataDir);
  const storage = await createStorage(dataDir);
  let sessions = (await storage.readSessions()).filter(session => session.expiresAt > now() && validAccount(session.account) && ALLOWED_ORIGINS.has(session.origin));
  const tasks = new Map();
  let initialized = false;
  const pendingPairs = new Map();
  const controllers = new Map();
  const workers = new Map();
  let modelTail = Promise.resolve();
  const synchronizing = new Map();
  const syncAfter = new Map();
  const shutdown = new AbortController();
  let pumping = false;
  let currentPump = Promise.resolve();
  let stopping = false;
  let pairWrites = Promise.resolve();
  const timestamp = () => new Date(now()).toISOString();
  const persist = async task => { task.updatedAt = timestamp(); await storage.saveTask(task); };
  const activeCount = () => [...tasks.values()].filter(task => !terminal.has(task.status)).length;

  function clearPrivateData(task) {
    for (const key of ['prompt', 'capability', 'submission', 'cancelRequested', 'failurePending', 'resumeSubmission', 'publishRetryCount', 'nextRetryAt']) delete task[key];
  }

  async function finish(task, status, result) {
    task.status = status;
    if (status === 'completed') { task.result = safeResult(result.result ?? result); delete task.error; }
    else if (status === 'cancelled') task.error = { code: 'CANCELLED', message: 'Generation was cancelled.' };
    else task.error ||= { code: 'GENERATION_FAILED', message: 'This task could not be completed.' };
    clearPrivateData(task);
    await persist(task);
  }

  const activate = activation => {
    // Even callers inside the same installation pass through the URI validator.
    const parsed = parseActivation(`joblit://connect?${new URLSearchParams(activation)}`);
    for (const [key, pair] of pendingPairs) if (pair.expiresAt < now()) pendingPairs.delete(key);
    if (pendingPairs.size >= 16) pendingPairs.delete(pendingPairs.keys().next().value);
    pendingPairs.set(hash(parsed.challenge), { ...parsed, challenge: undefined, expiresAt: now() + 120_000 });
  };

  async function remote(task, suffix = '', body, signal) {
    if (now() >= Date.parse(task.expiresAt)) throw problem(410, 'TASK_EXPIRED', 'This task expired. Start a new generation.');
    if (!ALLOWED_ORIGINS.has(task.apiOrigin) || !['', '/result', '/progress', '/cancel', '/failure'].includes(suffix)) throw problem(400, 'INVALID_DESTINATION', 'Invalid task destination.');
    let response;
    try {
      response = await fetchImpl(`${task.apiOrigin}/api/local-tailoring/tasks/${encodeURIComponent(task.taskId)}${suffix}`, {
        method: body === undefined ? 'GET' : 'POST', redirect: 'error',
        headers: { Authorization: `Bearer ${task.capability}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
      });
    } catch {
      if (signal?.aborted) throw problem(409, 'CANCELLED', 'The task was cancelled.');
      throw problem(503, 'REMOTE_UNAVAILABLE', 'Joblit could not be reached. The saved result will be retried.');
    }
    const text = await response.text();
    if (text.length > 1024 * 1024) throw problem(502, 'INVALID_RESPONSE', 'Joblit returned an invalid response.');
    let value;
    try { value = JSON.parse(text); } catch { throw problem(502, 'INVALID_RESPONSE', 'Joblit returned an invalid response.'); }
    if (!response.ok) throw problem(response.status, String(value.code || value.error?.code || 'REMOTE_REJECTED').slice(0, 80), String(value.message || value.error?.message || 'Joblit rejected this task.').slice(0, 300));
    return value.task ?? value;
  }

  async function remoteWithRetry(task, suffix, body, signal) {
    for (let attempt = 0; ; attempt++) {
      try { return await remote(task, suffix, body, signal); }
      catch (error) {
        if (signal?.aborted || error.status < 500 || attempt === 2) throw error;
        await pause(retryDelay, signal);
      }
    }
  }

  function synchronize(task) {
    if (stopping || (!task.cancelRequested && !task.failurePending)) return Promise.resolve();
    if (synchronizing.has(task.taskId)) return synchronizing.get(task.taskId);
    if ((syncAfter.get(task.taskId) || 0) > now()) return Promise.resolve();
    const promise = (async () => {
      // A cancelled process is not proof that an in-flight PDF publication was
      // cancelled. Keep the capability until the server confirms its outcome.
      for (let attempt = 0; attempt < 3 && !stopping; attempt++) {
        try {
          let result;
          try { result = await remote(task, task.cancelRequested ? '/cancel' : '/failure', task.cancelRequested ? {} : { code: 'LOCAL_GENERATION_FAILED' }, shutdown.signal); }
          catch (error) {
            if (shutdown.signal.aborted || error.status === 410) throw error;
            result = await remote(task, '', undefined, shutdown.signal);
          }
          if (terminal.has(result.status)) { await finish(task, result.status, result); return; }
        } catch (error) {
          if (stopping) return;
          if (error.status === 410 || error.status === 404) {
            task.error = { code: 'REMOTE_STATUS_UNCONFIRMED', message: 'This task can no longer be synchronized. Check its latest result in Joblit.' };
            await finish(task, 'failed'); return;
          }
        }
        if (task.cancelRequested) task.error = { code: 'CANCELLATION_PENDING', message: 'The local model has stopped. Waiting for Joblit to confirm the final result.' };
        await persist(task);
        if (attempt < 2) await pause(retryDelay, shutdown.signal);
      }
    })().catch(() => {}).finally(() => { synchronizing.delete(task.taskId); syncAfter.set(task.taskId, now() + retryDelay); });
    synchronizing.set(task.taskId, promise);
    return promise;
  }

  async function submitResult(task, signal) {
    const waitToRetry = async () => {
      task.publishRetryCount = Math.min((task.publishRetryCount || 0) + 1, 16);
      const delay = Math.min(retryDelay * 2 ** (task.publishRetryCount - 1), 60_000, Math.max(0, Date.parse(task.expiresAt) - now()));
      task.nextRetryAt = now() + delay;
      task.status = 'publishing';
      await persist(task);
      await pause(delay, signal);
    };
    if (task.nextRetryAt > now()) await pause(Math.min(task.nextRetryAt - now(), 60_000), signal);
    for (;;) {
      if (signal.aborted) throw problem(409, 'CANCELLED', 'The task was cancelled.');
      try {
        const result = await remote(task, '/result', { rawOutput: task.submission.rawOutput, attempt: task.submission.attempt }, signal);
        if (signal.aborted) throw problem(409, 'CANCELLED', 'The task was cancelled.');
        if (result.status !== 'publishing') return result;
        delete task.error;
        await waitToRetry();
        const status = await remote(task, '', undefined, signal);
        if (terminal.has(status.status) || status.status === 'repair') return status.result?.status ? status.result : status;
        // Re-send the identical durable submission. The server may reclaim an
        // expired publishing lease; GET alone cannot resume that work.
      } catch (error) {
        if (signal.aborted || error.status < 500 || error.code === 'TASK_EXPIRED') throw error;
        task.error = { code: 'PUBLICATION_WAITING', message: 'Your generated response is saved. Joblit will retry publishing when the service is available.' };
        await waitToRetry();
      }
    }
  }

  async function withModelSlot(signal, generate) {
    const previous = modelTail;
    let release;
    modelTail = new Promise(resolve => { release = resolve; });
    try {
      await previous;
      if (signal.aborted) throw problem(409, 'CANCELLED', 'The task was cancelled.');
      return await generate();
    } finally { release(); }
  }

  async function runTask(task) {
    const controller = new AbortController();
    controllers.set(task.taskId, controller);
    const { signal } = controller;
    try {
      if (task.resumeSubmission) {
        const result = await submitResult(task, signal);
        if (terminal.has(result.status)) { await finish(task, result.status, result); return; }
        throw problem(409, 'RESTART_REQUIRES_GENERATION', 'The saved response needs another model attempt. Start a new task to continue.');
      }
      const existing = await remoteWithRetry(task, '', undefined, signal);
      if (terminal.has(existing.status)) { await finish(task, existing.status, existing); return; }
      if (signal.aborted) throw problem(409, 'CANCELLED', 'The task was cancelled.');
      const readiness = await hermes.status();
      if (readiness.auth.state !== 'ready') throw problem(409, 'AUTH_REQUIRED', 'Connect your model account before generating.');
      let prompt = { ...task.prompt };
      const codes = new Set();
      for (let attempt = 1; attempt <= 3; attempt++) {
        if (signal.aborted) throw problem(409, 'CANCELLED', 'The task was cancelled.');
        task.attempt = attempt;
        task.status = attempt === 1 ? 'queued' : 'repairing';
        await persist(task);
        const rawOutput = await withModelSlot(signal, async () => {
          task.status = attempt === 1 ? 'running' : 'repairing';
          await persist(task);
          const progress = await remoteWithRetry(task, '/progress', { phase: 'generating', attempt }, signal);
          if (terminal.has(progress.status)) { await finish(task, progress.status, progress); return; }
          if (signal.aborted) throw problem(409, 'CANCELLED', 'The task was cancelled.');
          return hermes.generate(prompt, { signal });
        });
        if (terminal.has(task.status)) return;
        if (signal.aborted) throw problem(409, 'CANCELLED', 'The task was cancelled.');
        task.submission = { rawOutput, attempt };
        delete task.publishRetryCount;
        delete task.nextRetryAt;
        task.status = 'publishing';
        await persist(task);
        const result = await submitResult(task, signal);
        if (terminal.has(result.status)) { await finish(task, result.status, result); return; }
        const code = String(result.code || result.error?.code || 'GENERATION_REJECTED').slice(0, 80);
        const message = String(result.message || result.error?.message || 'The document did not pass its checks.').slice(0, 1200);
        if (result.status !== 'repair' || codes.has(code) || attempt === 3) throw problem(422, code, message);
        codes.add(code);
        const repair = typeof result.repairInstruction === 'string' ? result.repairInstruction.slice(0, 8000) : `Correct the rejected result: ${code}. ${message}`;
        prompt = { instructions: task.prompt.instructions, input: `${task.prompt.input}\n\nPrevious response:\n${rawOutput}\n\nRequired correction:\n${repair}\nReturn the complete corrected document only.` };
      }
    } catch (error) {
      if (stopping || terminal.has(task.status)) return;
      if (task.cancelRequested) { await synchronize(task); return; }
      task.status = 'failed';
      task.error = { code: String(error.code || 'GENERATION_FAILED').slice(0, 80), message: String(error.message || 'Generation failed.').slice(0, 300) };
      task.failurePending = true;
      delete task.prompt;
      delete task.submission;
      await persist(task);
      await synchronize(task);
    } finally { controllers.delete(task.taskId); }
  }

  async function pump() {
    if (pumping || stopping) return;
    pumping = true;
    try {
      for (const task of tasks.values()) {
        if (stopping) break;
        if (workers.has(task.taskId) || !(task.status === 'queued' || (task.status === 'publishing' && task.resumeSubmission))) continue;
        // Publication has its own bounded backoff. Only the model invocation
        // holds the shared slot, so an unavailable renderer cannot block jobs.
        const work = runTask(task).catch(() => {}).finally(() => { workers.delete(task.taskId); });
        workers.set(task.taskId, work);
      }
    } finally { pumping = false; }
  }

  const server = createServer(async (request, response) => {
    const send = (status, value) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(value === undefined ? '' : JSON.stringify(value));
    };
    try {
      const actualPort = server.address()?.port ?? port;
      if (![ `127.0.0.1:${actualPort}`, `localhost:${actualPort}` ].includes(request.headers.host)) throw problem(403, 'INVALID_HOST', 'This helper accepts loopback requests only.');
      const url = new URL(request.url, `http://127.0.0.1:${actualPort}`);
      const origin = request.headers.origin;
      const bearer = request.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{32,256})$/)?.[1];
      if (!initialized) throw problem(503, 'STARTING', 'The helper is starting. Retry shortly.');
      if (url.pathname.startsWith('/_')) {
        if (origin || !equal(bearer, secret)) throw problem(403, 'LOCAL_AUTH_REQUIRED', 'Installation authorization is required.');
        if (url.pathname === '/_activate' && request.method === 'POST') { activate(await readBody(request)); return send(200, { connected: true }); }
        if (url.pathname === '/_status' && request.method === 'GET') return send(200, { running: true, protocolVersion: PROTOCOL_VERSION, activeTasks: activeCount() });
        if (url.pathname === '/_stop' && request.method === 'POST') {
          if (activeCount()) throw problem(409, 'TASKS_ACTIVE', 'Wait for active tasks to finish or cancel them before stopping.');
          send(200, { stopped: true });
          stopping = true;
          hermes.close();
          server.close();
          return;
        }
        throw problem(404, 'NOT_FOUND', 'Unknown local action.');
      }
      if (!ALLOWED_ORIGINS.has(origin)) throw problem(403, 'ORIGIN_NOT_ALLOWED', 'Connect from Joblit to use this helper.');
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
      if (request.method === 'OPTIONS') {
        response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        if (request.headers['access-control-request-private-network'] === 'true') response.setHeader('Access-Control-Allow-Private-Network', 'true');
        return send(204);
      }
      if (url.pathname === '/health' && request.method === 'GET') return send(200, { app: 'joblit-companion', protocolVersion: PROTOCOL_VERSION, running: true });
      if (url.pathname === '/pair' && request.method === 'POST') {
        const body = await readBody(request);
        const challengeHash = hash(typeof body.challenge === 'string' ? body.challenge : '');
        const activation = pendingPairs.get(challengeHash);
        if (!activation || activation.origin !== origin || activation.account !== body.account || activation.expiresAt < now()) throw problem(403, 'PAIRING_REQUIRED', 'Open the connection link from Joblit, then retry.');
        pendingPairs.delete(challengeHash);
        const token = randomBytes(32).toString('base64url');
        sessions = sessions.filter(session => session.expiresAt > now());
        sessions.push({ tokenHash: hash(token), origin, account: body.account, expiresAt: now() + 30 * 24 * 60 * 60_000 });
        // Serialize independent browser pairings so neither session is lost.
        const snapshot = [...sessions];
        pairWrites = pairWrites.then(() => storage.saveSessions(snapshot));
        await pairWrites;
        return send(200, { token, account: body.account, protocolVersion: PROTOCOL_VERSION });
      }
      const session = bearer && sessions.find(item => item.origin === origin && item.expiresAt > now() && equal(item.tokenHash, hash(bearer)));
      if (!session) throw problem(401, 'PAIRING_REQUIRED', 'Connect this browser account to the helper first.');
      if (url.pathname === '/status' && request.method === 'GET') return send(200, { protocolVersion: PROTOCOL_VERSION, ...await hermes.status() });
      if (url.pathname === '/auth/start' && request.method === 'POST') { await readBody(request); return send(202, await hermes.startAuth()); }
      if (url.pathname === '/tasks' && request.method === 'GET') {
        for (const task of tasks.values()) if (task.account === session.account && task.apiOrigin === origin) void synchronize(task);
        return send(200, { tasks: [...tasks.values()].filter(task => task.account === session.account && task.apiOrigin === origin && (!url.searchParams.has('jobId') || task.jobId === url.searchParams.get('jobId')) && (!url.searchParams.has('target') || task.target === url.searchParams.get('target'))).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(publicTask) });
      }
      if (url.pathname === '/tasks' && request.method === 'POST') {
        const body = await readBody(request);
        const fingerprint = hash(JSON.stringify([body.capability, body.apiOrigin, body.prompt, body.jobId, body.target, body.expiresAt]));
        const existing = tasks.get(body.taskId);
        if (existing) {
          if (existing.account !== session.account || existing.apiOrigin !== origin || existing.fingerprint !== fingerprint) throw problem(409, 'TASK_ID_CONFLICT', 'This task ID already belongs to another request.');
          return send(200, { task: publicTask(existing) });
        }
        if (!validId(body.taskId) || !validId(body.jobId) || !['resume', 'cover'].includes(body.target) || body.apiOrigin !== origin || typeof body.capability !== 'string' || !/^[A-Za-z0-9._~-]{24,4096}$/.test(body.capability) || !body.prompt || typeof body.prompt.instructions !== 'string' || typeof body.prompt.input !== 'string' || body.prompt.instructions.length + body.prompt.input.length > 500_000 || typeof body.expiresAt !== 'string' || !Number.isFinite(Date.parse(body.expiresAt)) || Date.parse(body.expiresAt) <= now() || Date.parse(body.expiresAt) > now() + 3 * 60 * 60_000) throw problem(400, 'INVALID_TASK', 'This generation request is invalid or expired.');
        if (activeCount() >= 8) throw problem(429, 'QUEUE_FULL', 'Wait for another task to finish before generating.');
        const task = { taskId: body.taskId, jobId: body.jobId, target: body.target, capability: body.capability, apiOrigin: body.apiOrigin, prompt: { instructions: body.prompt.instructions, input: body.prompt.input }, expiresAt: body.expiresAt, account: session.account, fingerprint, status: 'queued', attempt: 0, createdAt: timestamp(), updatedAt: timestamp() };
        tasks.set(task.taskId, task);
        try { await persist(task); } catch (error) { tasks.delete(task.taskId); throw error; }
        send(202, { task: publicTask(task) });
        setImmediate(() => { if (!pumping && !stopping) currentPump = pump().catch(() => {}); });
        return;
      }
      const match = url.pathname.match(/^\/tasks\/([A-Za-z0-9_-]{1,100})(\/cancel)?$/);
      if (match) {
        const task = tasks.get(match[1]);
        if (!task || task.account !== session.account || task.apiOrigin !== origin) throw problem(404, 'TASK_NOT_FOUND', 'This task was not found.');
        if (!match[2] && request.method === 'GET') { void synchronize(task); return send(200, { task: publicTask(task) }); }
        if (match[2] && request.method === 'POST') {
          await readBody(request);
          if (!terminal.has(task.status)) {
            task.cancelRequested = true;
            task.status = 'cancelling';
            controllers.get(task.taskId)?.abort();
            task.error = { code: 'CANCELLATION_PENDING', message: 'Stopping the local model and confirming the final result with Joblit.' };
            await persist(task);
            void synchronize(task);
          }
          return send(task.status === 'cancelling' ? 202 : 200, { task: publicTask(task) });
        }
      }
      throw problem(404, 'NOT_FOUND', 'This action is not supported.');
    } catch (error) {
      if (!response.headersSent) send(error.status || 500, { error: { code: error.code || 'HELPER_ERROR', message: error.status ? error.message : 'The local helper could not complete the request.' } });
      else response.end();
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  return {
    server, secret, activate,
    listen: () => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', async () => {
        server.removeListener('error', reject);
        try {
          // Only the process which owns the listening socket may recover tasks.
          // A second launcher must never mark the first process's work failed.
          for (const task of await storage.readTasks()) {
            if (!validId(task.taskId) || !ALLOWED_ORIGINS.has(task.apiOrigin)) continue;
            if (task.cancelRequested) task.status = 'cancelling';
            else if (!terminal.has(task.status) && typeof task.submission?.rawOutput === 'string' && [1, 2, 3].includes(task.submission.attempt)) {
              task.status = 'publishing';
              task.resumeSubmission = true;
            } else if (!terminal.has(task.status)) {
              task.status = 'failed';
              task.error = { code: 'COMPANION_RESTARTED', message: 'The helper restarted. Start a new task to generate again.' };
              task.failurePending = true;
              delete task.prompt;
              delete task.submission;
            }
            if (terminal.has(task.status) && !task.failurePending) clearPrivateData(task);
            await persist(task);
            tasks.set(task.taskId, task);
          }
          initialized = true;
          resolve(server.address());
          setImmediate(() => {
            for (const task of tasks.values()) void synchronize(task);
            if (!pumping && !stopping) currentPump = pump().catch(() => {});
          });
        } catch (error) { server.close(); reject(error); }
      });
    }),
    async close() { stopping = true; shutdown.abort(); for (const controller of controllers.values()) controller.abort(); hermes.close(); await currentPump; await Promise.allSettled([...workers.values(), ...synchronizing.values()]); await new Promise(resolve => server.close(resolve)); },
  };
}
