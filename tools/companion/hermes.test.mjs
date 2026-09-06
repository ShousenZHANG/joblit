import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHermes, hermesExecutable } from './hermes.mjs';

function child() {
  const process = new EventEmitter();
  Object.assign(process, { pid: 12345, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() });
  return process;
}

test('discovers custom HERMES_HOME launchers before the default installation', async t => {
  const prefix = join(tmpdir(), 'joblit-hermes-path-');
  const directory = await mkdtemp(prefix);
  t.after(async () => { assert.ok(directory.startsWith(prefix)); await rm(directory, { recursive: true, force: true }); });
  const custom = join(directory, 'Custom Hermes');
  const local = join(directory, 'LocalAppData');
  const standard = join(local, 'hermes', 'bin', 'hermes.exe');
  const launcher = join(custom, 'bin', 'hermes.exe');
  const legacy = join(custom, 'hermes-agent', 'venv', 'Scripts', 'hermes.exe');
  for (const path of [join(custom, 'bin'), join(custom, 'hermes-agent', 'venv', 'Scripts'), join(local, 'hermes', 'bin')]) await mkdir(path, { recursive: true });
  for (const path of [standard, launcher, legacy]) await writeFile(path, 'path-discovery-only');
  const env = { HERMES_HOME: custom, LOCALAPPDATA: local };
  assert.equal(hermesExecutable(env, 'win32'), launcher);
  assert.equal(hermesExecutable({ HERMES_HOME: custom }, 'win32'), launcher);
  await rm(launcher);
  assert.equal(hermesExecutable(env, 'win32'), legacy);
  await rm(legacy);
  assert.equal(hermesExecutable(env, 'win32'), standard);
  assert.equal(hermesExecutable({}, 'win32'), 'hermes.exe');
});

test('passes long untrusted prompts through stdin without a shell', async () => {
  let launched;
  let input = '';
  const hermes = createHermes({ platform: 'win32', env: { HERMES_EXE: 'C:\\Hermes\\hermes.exe' }, spawnImpl(executable, args, options) {
    launched = { executable, args, options };
    const process = child();
    process.stdin.on('data', chunk => { input += chunk; });
    process.stdin.on('finish', () => { process.stdout.write('valid result'); process.emit('close', 0); });
    return process;
  } });
  const prompt = { instructions: 'Return JSON.', input: '$() ` & | '.repeat(10000) };
  assert.equal(await hermes.generate(prompt), 'valid result');
  assert.equal(input, `${prompt.instructions}\n\n${prompt.input}`);
  assert.ok(launched.args.includes('--query-file'));
  assert.equal(launched.options.shell, false);
  assert.equal(launched.options.windowsHide, true);
  assert.equal(launched.options.env.PYTHONUNBUFFERED, '1');
  assert.ok(!launched.args.some(value => value.includes(prompt.input)));
  assert.throws(() => hermesExecutable({ HERMES_EXE: 'C:\\Hermes\\hermes.cmd' }, 'win32'));
});

test('abort invokes process-tree termination and waits for the child close', async () => {
  const process = child();
  let killed = false;
  const hermes = createHermes({ spawnImpl: () => process, killTree: target => { assert.equal(target, process); killed = true; target.emit('close', 1); } });
  const controller = new AbortController();
  const generated = hermes.generate({ instructions: '', input: 'test' }, { signal: controller.signal });
  controller.abort();
  await assert.rejects(generated, error => error.code === 'CANCELLED');
  assert.equal(killed, true);
});

test('returns only device-code guidance, never raw auth output', async () => {
  let process;
  const hermes = createHermes({ spawnImpl: () => { process = child(); return process; } });
  await hermes.startAuth();
  process.stdout.write('Open https://auth.openai.com/codex/device\nABCD-1234\nsecret-token-do-not-return');
  const status = await hermes.status();
  assert.deepEqual(status.auth, { state: 'authenticating', userCode: 'ABCD-1234', loginUrl: 'https://auth.openai.com/codex/device' });
  assert.equal(JSON.stringify(status).includes('secret-token'), false);
  process.emit('close', 0);
});

test('coalesces readiness probes and does not overwrite a newer login flow', async () => {
  const children = [];
  const hermes = createHermes({ spawnImpl: () => { const process = child(); children.push(process); return process; } });
  const first = hermes.status();
  const second = hermes.status();
  assert.equal(children.length, 1);
  await hermes.startAuth();
  assert.equal(children.length, 2);
  children[0].stdout.write('openai-codex: logged in\n');
  children[0].emit('close', 0);
  assert.equal((await first).auth.state, 'authenticating');
  assert.equal((await second).auth.state, 'authenticating');
  children[1].emit('close', 0);
});
