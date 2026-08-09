import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { writeFile } from "node:fs/promises";
import test from "node:test";

import { createCodexClient } from "./codexClient.mjs";

/**
 * A stand-in for a spawned `codex exec`. It records how it was invoked, lets a
 * test decide what the process does, and behaves like a real child process
 * closely enough for the client's plumbing (stdin end, piped stdout/stderr,
 * close/error events, kill).
 */
function fakeSpawn(behaviour) {
  const calls = [];
  const impl = (binary, args, options) => {
    const child = new EventEmitter();
    const outPath = args[args.indexOf("-o") + 1];
    child.stdin = new (class extends EventEmitter {
      end(value) {
        calls.at(-1).stdin = value;
      }
    })();
    child.stdout = new EventEmitter();
    child.stdout.setEncoding = () => {};
    child.stderr = new EventEmitter();
    child.stderr.setEncoding = () => {};
    child.killed = false;
    child.kill = () => {
      child.killed = true;
    };
    calls.push({ binary, args, options, outPath, child, stdin: undefined });
    // Run the scripted behaviour after the client has attached its listeners.
    setImmediate(() => {
      void behaviour({ child, outPath, args });
    });
    return child;
  };
  return { impl, calls };
}

const PROMPT = { instructions: "system rules", input: "job description" };

test("returns the final message the CLI wrote, not its stdout banner", async () => {
  const { impl, calls } = fakeSpawn(async ({ child, outPath }) => {
    child.stdout.emit("data", "OpenAI Codex v0.147.0\nworkdir: ...\n");
    await writeFile(outPath, '{"cvSummary":"ok","addedBullets":[]}\n', "utf8");
    child.emit("close", 0);
  });
  const client = createCodexClient({ spawnImpl: impl });

  const output = await client.generate({ ...PROMPT, sessionId: "joblit:t1:resume" });

  assert.equal(output, '{"cvSummary":"ok","addedBullets":[]}');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].stdin, "system rules\n\njob description");
});

test("invokes Codex as a text generator, never as a coding agent", async () => {
  const { impl, calls } = fakeSpawn(async ({ child, outPath }) => {
    await writeFile(outPath, "done", "utf8");
    child.emit("close", 0);
  });
  const client = createCodexClient({ spawnImpl: impl, model: "gpt-5.6-terra" });

  await client.generate({ ...PROMPT, sessionId: "joblit:t1:resume" });

  const args = calls[0].args;
  // A job description is untrusted internet text that goes straight into the
  // prompt. Every one of these keeps it from reaching anything.
  assert.deepEqual(args.slice(0, 2), ["exec", "--sandbox"]);
  assert.equal(args[2], "read-only");
  assert.ok(args.includes("--ephemeral"));
  assert.ok(args.includes("--ignore-user-config"));
  assert.ok(args.includes("--ignore-rules"));
  assert.ok(args.includes("web_search=disabled"));
  assert.ok(args.includes("features.shell_tool=false"));
  // Runs in a throwaway directory, not the user's workspace.
  const cwd = args[args.indexOf("--cd") + 1];
  assert.equal(cwd, calls[0].options.cwd);
  assert.match(cwd, /joblit-codex-/);
  assert.deepEqual(args.slice(-3), ["-o", calls[0].outPath, "-"]);
  assert.ok(args.includes("gpt-5.6-terra"));
});

test("omits the model flag when none is pinned", async () => {
  const { impl, calls } = fakeSpawn(async ({ child, outPath }) => {
    await writeFile(outPath, "done", "utf8");
    child.emit("close", 0);
  });
  await createCodexClient({ spawnImpl: impl }).generate({
    ...PROMPT,
    sessionId: "joblit:t1:resume",
  });
  assert.ok(!calls[0].args.includes("-m"));
});

test("reports a missing CLI as an actionable install instruction", async () => {
  const { impl } = fakeSpawn(({ child }) => {
    const error = new Error("spawn codex ENOENT");
    error.code = "ENOENT";
    child.emit("error", error);
  });
  const client = createCodexClient({ spawnImpl: impl });

  await assert.rejects(
    client.generate({ ...PROMPT, sessionId: "joblit:t1:resume" }),
    (error) => {
      assert.equal(error.code, "CODEX_UNAVAILABLE");
      assert.match(error.message, /npm i -g @openai\/codex/);
      return true;
    },
  );
});

test("surfaces a non-zero exit with the CLI's own diagnostics", async () => {
  const { impl } = fakeSpawn(({ child }) => {
    child.stderr.emit("data", "stream error: unauthorized");
    child.emit("close", 1);
  });
  const client = createCodexClient({ spawnImpl: impl });

  await assert.rejects(
    client.generate({ ...PROMPT, sessionId: "joblit:t7:cover" }),
    (error) => {
      assert.equal(error.code, "CODEX_FAILED");
      assert.match(error.message, /unauthorized/);
      // The session is named so a batch log says which target failed.
      assert.match(error.message, /joblit:t7:cover/);
      return true;
    },
  );
});

test("treats a clean exit with no final message as a failure, not empty output", async () => {
  const { impl } = fakeSpawn(({ child }) => {
    child.emit("close", 0);
  });
  const client = createCodexClient({ spawnImpl: impl });

  await assert.rejects(
    client.generate({ ...PROMPT, sessionId: "joblit:t1:resume" }),
    (error) => {
      assert.equal(error.code, "CODEX_NO_OUTPUT");
      return true;
    },
  );
});

test("kills the child and rejects when the batch is cancelled", async () => {
  let spawned;
  const { impl } = fakeSpawn(({ child }) => {
    spawned = child;
    // Never completes on its own — cancellation is what ends it.
  });
  const controller = new AbortController();
  const client = createCodexClient({ spawnImpl: impl });
  const pending = client.generate({
    ...PROMPT,
    sessionId: "joblit:t1:resume",
    signal: controller.signal,
  });

  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();

  await assert.rejects(pending, (error) => {
    assert.equal(error.code, "CODEX_ABORTED");
    return true;
  });
  assert.equal(spawned.killed, true);
});

test("kills the child when it outlives the timeout", async () => {
  let spawned;
  const { impl } = fakeSpawn(({ child }) => {
    spawned = child;
  });
  const client = createCodexClient({ spawnImpl: impl, timeoutMs: 20 });

  await assert.rejects(
    client.generate({ ...PROMPT, sessionId: "joblit:t1:resume" }),
    (error) => {
      assert.equal(error.code, "CODEX_TIMEOUT");
      return true;
    },
  );
  assert.equal(spawned.killed, true);
});

test("rejects an empty prompt before spawning anything", async () => {
  const { impl, calls } = fakeSpawn(() => {});
  const client = createCodexClient({ spawnImpl: impl });

  await assert.rejects(
    client.generate({ instructions: "", input: "x", sessionId: "joblit:t1:resume" }),
    (error) => {
      assert.equal(error.code, "RUN_REQUEST_INVALID");
      return true;
    },
  );
  assert.equal(calls.length, 0);
});

test("acknowledge is a no-op — a finished Codex run left nothing behind", async () => {
  const client = createCodexClient({ spawnImpl: fakeSpawn(() => {}).impl });
  await client.acknowledge({ sessionId: "joblit:t1:resume" });
});
