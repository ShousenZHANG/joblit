import { mkdir, readFile, writeFile, rename, readdir, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';

export const defaultDataDir = () => process.env.JOBLIT_COMPANION_DATA_DIR || join(process.env.LOCALAPPDATA || join(homedir(), '.local', 'share'), 'Joblit', 'companion');
export async function readJson(path, fallback = null) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
export async function writeJson(path, value) {
  const temporary = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
  await rename(temporary, path);
}
export async function installationSecret(dataDir) {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const path = join(dataDir, 'installation.secret');
  try { await writeFile(path, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const secret = (await readFile(path, 'utf8')).trim();
  if (!/^[a-f0-9]{64}$/.test(secret)) throw new Error('The companion installation secret is invalid.');
  return secret;
}
export async function createStorage(dataDir) {
  await mkdir(join(dataDir, 'accounts'), { recursive: true, mode: 0o700 });
  // Windows installers also set the directory ACL to the current OS user.
  await chmod(dataDir, 0o700).catch(() => {});
  const sessionsPath = join(dataDir, 'sessions.json');
  const writes = new Map();
  return {
    dataDir,
    readSessions: () => readJson(sessionsPath, []),
    saveSessions: sessions => writeJson(sessionsPath, sessions),
    async saveTask(task) {
      if (!/^[a-f0-9]{64}$/.test(task.account) || !/^[A-Za-z0-9_-]{1,100}$/.test(task.taskId)) throw new Error('Invalid task storage path.');
      const directory = join(dataDir, 'accounts', task.account);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const path = join(directory, `${task.taskId}.json`);
      const snapshot = structuredClone(task);
      const write = (writes.get(path) || Promise.resolve()).catch(() => {}).then(() => writeJson(path, snapshot));
      writes.set(path, write);
      try { await write; } finally { if (writes.get(path) === write) writes.delete(path); }
    },
    async readTasks() {
      const tasks = [];
      for (const account of await readdir(join(dataDir, 'accounts'), { withFileTypes: true })) {
        if (!account.isDirectory() || !/^[a-f0-9]{64}$/.test(account.name)) continue;
        const directory = join(dataDir, 'accounts', account.name);
        for (const file of await readdir(directory, { withFileTypes: true })) {
          if (!file.isFile() || !/^[A-Za-z0-9_-]{1,100}\.json$/.test(file.name)) continue;
          const task = await readJson(join(directory, file.name));
          if (task?.account === account.name && `${task.taskId}.json` === file.name) tasks.push(task);
        }
      }
      return tasks;
    },
  };
}
