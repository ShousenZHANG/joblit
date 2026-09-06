import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const PROVIDER = 'openai-codex';
export const DEFAULT_MODEL = 'gpt-5.6-sol';
const stripAnsi = value => value.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');

export function hermesExecutable(env = process.env, platform = process.platform) {
  if (env.HERMES_EXE) {
    if (platform === 'win32' && !/\.exe$/i.test(env.HERMES_EXE)) throw new Error('HERMES_EXE must point to a Windows executable.');
    return env.HERMES_EXE;
  }
  if (platform === 'win32') {
    const homes = new Set([env.HERMES_HOME, env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'hermes')].filter(Boolean));
    for (const home of homes) {
      for (const path of [join(home, 'bin', 'hermes.exe'), join(home, 'hermes-agent', 'venv', 'Scripts', 'hermes.exe')]) {
        if (existsSync(path)) return path;
      }
    }
  }
  return platform === 'win32' ? 'hermes.exe' : 'hermes';
}

export function killProcessTree(child, platform = process.platform) {
  if (!child.pid) return;
  if (platform === 'win32') {
    const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', shell: false });
    killer.on('error', () => child.kill());
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
    const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 500);
    timer.unref();
    child.once('close', () => clearTimeout(timer));
  }
}

export function createHermes({ spawnImpl = spawn, killTree = killProcessTree, env = process.env, platform = process.platform, model = env.JOBLIT_COMPANION_MODEL || DEFAULT_MODEL } = {}) {
  let auth = { state: 'required' };
  let cachedAt = 0;
  let authRun = null;
  let statusRun = null;
  let authVersion = 0;
  const children = new Set();
  const execute = (args, { input = '', signal, timeout = 600_000, onOutput } = {}) => new Promise((resolve, reject) => {
    let child;
    let output = '';
    let errorOutput = '';
    let failure;
    let timer;
    const stop = (code, message) => {
      failure ||= Object.assign(new Error(message), { code });
      if (child) killTree(child, platform);
    };
    const abort = () => stop('CANCELLED', 'Generation was cancelled.');
    if (signal?.aborted) return reject(Object.assign(new Error('Generation was cancelled.'), { code: 'CANCELLED' }));
    try {
      const childEnv = { ...env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', PYTHONUNBUFFERED: '1' };
      if (!childEnv.HERMES_HOME && platform === 'win32' && env.LOCALAPPDATA) childEnv.HERMES_HOME = join(env.LOCALAPPDATA, 'hermes');
      child = spawnImpl(hermesExecutable(env, platform), args, { env: childEnv, shell: false, windowsHide: true, detached: platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
      children.add(child);
      const receive = (chunk, stderr = false) => {
        if (failure) return;
        if (stderr) errorOutput += chunk.toString('utf8');
        else output += chunk.toString('utf8');
        if (Buffer.byteLength(output) + Buffer.byteLength(errorOutput) > 2 * 1024 * 1024) stop('OUTPUT_LIMIT', 'The model response exceeded the local output limit.');
        onOutput?.(stripAnsi(`${output}\n${errorOutput}`));
      };
      child.stdout.on('data', chunk => receive(chunk));
      child.stderr.on('data', chunk => receive(chunk, true));
      child.once('error', () => { failure ||= Object.assign(new Error('Hermes could not start. Install Hermes or check its executable path.'), { code: 'HERMES_UNAVAILABLE' }); });
      child.once('close', code => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        children.delete(child);
        if (failure) reject(failure);
        else if (code !== 0) reject(Object.assign(new Error('Hermes could not complete this request. Check your model login and available quota.'), { code: 'HERMES_FAILED' }));
        else resolve(stripAnsi(output));
      });
      signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => stop('HERMES_TIMEOUT', 'Hermes exceeded the time limit.'), timeout);
      timer.unref?.();
      child.stdin.on('error', () => {});
      child.stdin.end(input);
    } catch (error) { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(error); }
  });

  return {
    async status(force = false) {
      if (authRun) return { runtime: { state: 'ready' }, auth: { ...auth } };
      if (statusRun) return statusRun;
      if (!force && Date.now() - cachedAt < 10_000) return { runtime: { state: auth.state === 'unavailable' ? 'unavailable' : 'ready' }, auth: { ...auth } };
      const version = authVersion;
      statusRun = (async () => {
        try {
          const output = await execute(['auth', 'status', PROVIDER], { timeout: 15_000 });
          if (version === authVersion) auth = { state: /^openai-codex:\s*logged in\s*$/m.test(output) ? 'ready' : 'required' };
        } catch { if (version === authVersion) auth = { state: 'unavailable', message: 'Install Hermes, then connect your model account.' }; }
        if (version === authVersion) cachedAt = Date.now();
        return { runtime: { state: auth.state === 'unavailable' ? 'unavailable' : 'ready' }, auth: { ...auth } };
      })().finally(() => { statusRun = null; });
      return statusRun;
    },
    async startAuth() {
      if (authRun) return { auth: { ...auth } };
      authVersion++;
      auth = { state: 'authenticating' };
      authRun = execute(['auth', 'add', PROVIDER], { timeout: 15 * 60_000, onOutput(text) {
        const userCode = text.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/)?.[0];
        if (userCode && text.includes('https://auth.openai.com/codex/device')) auth = { state: 'authenticating', userCode, loginUrl: 'https://auth.openai.com/codex/device' };
      } }).then(() => { auth = { state: 'required' }; cachedAt = 0; }, () => { auth = { state: 'required', message: 'Sign-in did not complete. You can try again.' }; cachedAt = Date.now(); }).finally(() => { authRun = null; });
      return { auth: { ...auth } };
    },
    generate(prompt, { signal } = {}) {
      // stdin avoids Windows command-line limits and all shell interpretation.
      return execute(['chat', '--oneshot', '--quiet', '--query-file', '-', '--safe-mode', '-t', 'safe', '--provider', PROVIDER, '-m', model], { input: `${prompt.instructions}\n\n${prompt.input}`, signal });
    },
    close() { for (const child of children) killTree(child, platform); },
  };
}
