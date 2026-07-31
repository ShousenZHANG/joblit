import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

const STATE_FORMAT_VERSION = 1;
const RUN_ID_RE = /^run_[0-9a-f]{32}$/;
const FEEDBACK_HASH_RE = /^[0-9a-f]{64}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROMPT_HASH_RE = /^[0-9a-f]{64}$/;
const SESSION_ID_RE = /^joblit:[A-Za-z0-9:_-]{1,120}$/;
const PHASES = new Set([
  "idle",
  "starting",
  "running",
  "completed",
  "repairing",
]);
const LOCK_WAIT_MS = 5_000;
const LOCK_RETRY_MS = 25;
const STALE_LOCK_MS = 30_000;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isValidOperation(value) {
  return (
    isRecord(value) &&
    Object.keys(value).length === 4 &&
    typeof value.tailoringRunId === "string" &&
    UUID_RE.test(value.tailoringRunId) &&
    typeof value.attemptId === "string" &&
    UUID_RE.test(value.attemptId) &&
    (value.target === "resume" || value.target === "cover") &&
    typeof value.promptHash === "string" &&
    PROMPT_HASH_RE.test(value.promptHash)
  );
}

function validateRunState(value) {
  if (
    !isRecord(value) ||
    !PHASES.has(value.phase) ||
    typeof value.repairUsed !== "boolean"
  ) {
    throw new Error("Runner state is invalid; refusing unsafe recovery");
  }
  const allowedKeys = new Set(["phase", "repairUsed"]);
  if (
    value.phase === "running" ||
    value.phase === "completed" ||
    value.phase === "repairing"
  ) {
    allowedKeys.add("runId");
  }
  if (value.phase === "repairing") {
    allowedKeys.add("feedbackHash");
    allowedKeys.add("baselineMessageId");
  }
  const mayOwnOperation =
    value.phase === "starting" ||
    value.phase === "running" ||
    value.phase === "completed" ||
    value.phase === "repairing";
  if (mayOwnOperation) allowedKeys.add("operation");
  const unsupportedFields = Object.keys(value).filter(
    (key) => !allowedKeys.has(key),
  );
  if (unsupportedFields.length > 0) {
    throw new Error(
      `Runner state contains unsupported fields: ${unsupportedFields.join(", ")}`,
    );
  }
  if (
    value.phase === "running" ||
    value.phase === "completed" ||
    value.phase === "repairing"
  ) {
    if (typeof value.runId !== "string" || !RUN_ID_RE.test(value.runId)) {
      throw new Error("Runner state has an invalid Hermes run id");
    }
  } else if ("runId" in value) {
    throw new Error("Runner state carries a run id in an invalid phase");
  }
  if (
    value.phase === "repairing" &&
    (value.repairUsed !== true ||
      typeof value.feedbackHash !== "string" ||
      !FEEDBACK_HASH_RE.test(value.feedbackHash) ||
      !Number.isSafeInteger(value.baselineMessageId) ||
      value.baselineMessageId <= 0)
  ) {
    throw new Error("Runner state has invalid Hermes repair metadata");
  }
  if (
    ("operation" in value &&
      (!mayOwnOperation || !isValidOperation(value.operation))) ||
    (!mayOwnOperation && "operation" in value)
  ) {
    throw new Error("Runner state has invalid Agent operation metadata");
  }
  return structuredClone(value);
}

function parseDocument(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Runner state file is not valid JSON; refusing unsafe recovery");
  }
  if (
    !isRecord(parsed) ||
    parsed.version !== STATE_FORMAT_VERSION ||
    !isRecord(parsed.sessions)
  ) {
    throw new Error("Runner state file has an unsupported format");
  }
  const sessions = Object.create(null);
  for (const [sessionId, state] of Object.entries(parsed.sessions)) {
    if (!SESSION_ID_RE.test(sessionId)) {
      throw new Error("Runner state file contains an invalid session id");
    }
    sessions[sessionId] = validateRunState(state);
  }
  return sessions;
}

export function defaultRunStatePath() {
  return join(homedir(), ".joblit", "runner-state-v1.json");
}

/**
 * Durable local state for Hermes run recovery. Only opaque session/run ids,
 * the one-repair allowance, hashes, a transcript message cursor and the
 * non-secret Joblit operation identity are persisted; prompts, feedback text,
 * model output and credentials are deliberately excluded.
 */
export function createFileRunStateStore({
  filePath = defaultRunStatePath(),
  lockWaitMs = LOCK_WAIT_MS,
  lockRetryMs = LOCK_RETRY_MS,
  staleLockMs = STALE_LOCK_MS,
} = {}) {
  let pendingWrite = Promise.resolve();
  const lockPath = `${filePath}.lock`;

  function isLiveLocalProcess(pid) {
    if (!Number.isSafeInteger(pid) || pid <= 0) return false;
    if (pid === process.pid) return true;
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return Boolean(
        error && typeof error === "object" && error.code === "EPERM",
      );
    }
  }

  async function removeStaleLock() {
    let lockStat;
    let observedText;
    try {
      lockStat = await stat(lockPath);
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ENOENT") {
        return true;
      }
      throw error;
    }
    if (Date.now() - lockStat.mtimeMs < staleLockMs) return false;

    try {
      observedText = await readFile(lockPath, "utf8");
      const lock = JSON.parse(observedText);
      if (isRecord(lock) && isLiveLocalProcess(lock.pid)) return false;
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ENOENT") {
        return true;
      }
      // The old owner may have disappeared and a new owner may still be
      // writing its record. Re-check age before treating malformed data as
      // abandoned.
      try {
        const currentStat = await stat(lockPath);
        if (Date.now() - currentStat.mtimeMs < staleLockMs) return false;
      } catch (statError) {
        if (
          statError &&
          typeof statError === "object" &&
          statError.code === "ENOENT"
        ) {
          return true;
        }
        throw statError;
      }
    }

    // Re-read both the owner record and file identity immediately before
    // removal. A previous owner may have released the lock and a new Runner
    // may have acquired the same path while the stale check was in flight; in
    // that case the new owner always wins and this contender goes back to
    // waiting instead of deleting somebody else's lock.
    try {
      const [currentText, currentStat] = await Promise.all([
        readFile(lockPath, "utf8"),
        stat(lockPath),
      ]);
      if (
        observedText === undefined ||
        currentText !== observedText ||
        currentStat.mtimeMs !== lockStat.mtimeMs ||
        currentStat.size !== lockStat.size
      ) {
        return false;
      }
      const current = JSON.parse(currentText);
      if (isRecord(current) && isLiveLocalProcess(current.pid)) return false;
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ENOENT") {
        return true;
      }
      // A stable, old malformed record may be reaped, but a record that
      // changed during inspection is never removed.
      try {
        const currentStat = await stat(lockPath);
        if (
          currentStat.mtimeMs !== lockStat.mtimeMs ||
          currentStat.size !== lockStat.size
        ) {
          return false;
        }
      } catch (statError) {
        if (
          statError &&
          typeof statError === "object" &&
          statError.code === "ENOENT"
        ) {
          return true;
        }
        throw statError;
      }
    }

    // A crashed process cannot release its file. Removing an old lock lets a
    // later Runner recover. A live local PID always wins even if its write was
    // delayed beyond the age threshold.
    await rm(lockPath, { force: true });
    return true;
  }

  async function acquireLock() {
    const deadline = Date.now() + lockWaitMs;
    await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });

    for (;;) {
      const owner = randomUUID();
      try {
        const handle = await open(lockPath, "wx", 0o600);
        try {
          await handle.writeFile(
            `${JSON.stringify({
              owner,
              pid: process.pid,
              createdAt: new Date().toISOString(),
            })}\n`,
            "utf8",
          );
        } catch (error) {
          await handle.close().catch(() => undefined);
          await rm(lockPath, { force: true }).catch(() => undefined);
          throw error;
        }
        await handle.close();
        return async () => {
          try {
            const current = JSON.parse(await readFile(lockPath, "utf8"));
            if (current?.owner === owner) {
              await rm(lockPath, { force: true });
            }
          } catch (error) {
            if (error && typeof error === "object" && error.code === "ENOENT") {
              return;
            }
            throw error;
          }
        };
      } catch (error) {
        if (!error || typeof error !== "object" || error.code !== "EEXIST") {
          throw error;
        }
        if (await removeStaleLock()) continue;
        if (Date.now() >= deadline) {
          throw new Error(
            "Runner state lock timed out; another local Runner may be updating this machine's recovery state",
          );
        }
        await new Promise((resolve) => setTimeout(resolve, lockRetryMs));
      }
    }
  }

  async function withLock(operation) {
    const release = await acquireLock();
    try {
      return await operation();
    } finally {
      await release();
    }
  }

  async function readSessions() {
    try {
      return parseDocument(await readFile(filePath, "utf8"));
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ENOENT") {
        return Object.create(null);
      }
      throw error;
    }
  }

  async function writeSessions(sessions) {
    const parent = dirname(filePath);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(
        temporaryPath,
        `${JSON.stringify({
          version: STATE_FORMAT_VERSION,
          sessions,
        })}\n`,
        { encoding: "utf8", flag: "wx", mode: 0o600 },
      );
      await rename(temporaryPath, filePath);
      await chmod(filePath, 0o600);
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }

  function enqueueWrite(operation) {
    const write = pendingWrite.then(operation);
    // The caller still receives this write's failure, but a transient lock or
    // filesystem error must not poison every later operation in the process.
    pendingWrite = write.catch(() => undefined);
    return write;
  }

  return {
    async get(sessionId) {
      await pendingWrite;
      const sessions = await readSessions();
      const state = sessions[sessionId];
      return state ? structuredClone(state) : null;
    },

    async list() {
      await pendingWrite;
      const sessions = await readSessions();
      return Object.entries(sessions).map(([sessionId, state]) => ({
        sessionId,
        state: structuredClone(state),
      }));
    },

    async set(sessionId, value) {
      if (typeof sessionId !== "string" || !SESSION_ID_RE.test(sessionId)) {
        throw new Error("Runner session id is invalid");
      }
      const state = validateRunState(value);
      const write = enqueueWrite(() =>
        withLock(async () => {
          const sessions = await readSessions();
          sessions[sessionId] = state;
          await writeSessions(sessions);
        }),
      );
      await write;
    },

    /**
     * Atomically replace one session only when its durable state is unchanged.
     *
     * This is the single-flight seam for a Hermes start/repair reservation:
     * separate Runner processes can both observe the same state, but only one
     * compare-and-set may cross the network boundary.
     */
    async compareAndSet(sessionId, expectedValue, nextValue) {
      if (typeof sessionId !== "string" || !SESSION_ID_RE.test(sessionId)) {
        throw new Error("Runner session id is invalid");
      }
      const expected =
        expectedValue === null ? null : validateRunState(expectedValue);
      const next = nextValue === null ? null : validateRunState(nextValue);
      return enqueueWrite(() =>
        withLock(async () => {
          const sessions = await readSessions();
          const current = sessions[sessionId] ?? null;
          if (!isDeepStrictEqual(current, expected)) return false;
          if (next === null) {
            if (!(sessionId in sessions)) return true;
            delete sessions[sessionId];
          } else {
            sessions[sessionId] = next;
          }
          await writeSessions(sessions);
          return true;
        }),
      );
    },

    async delete(sessionId) {
      if (typeof sessionId !== "string" || !SESSION_ID_RE.test(sessionId)) {
        throw new Error("Runner session id is invalid");
      }
      const write = enqueueWrite(() =>
        withLock(async () => {
          const sessions = await readSessions();
          if (!(sessionId in sessions)) return;
          delete sessions[sessionId];
          await writeSessions(sessions);
        }),
      );
      await write;
    },
  };
}
