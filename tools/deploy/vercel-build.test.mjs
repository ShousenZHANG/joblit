import assert from "node:assert/strict";
import test from "node:test";

import { buildPlan, runBuildPlan } from "./vercel-build.mjs";

test("runs migrations before a production build", () => {
  assert.deepEqual(buildPlan("production"), ["db:migrate:deploy", "build"]);
});

test("never migrates preview, development, custom, or local builds", () => {
  for (const environment of [undefined, "preview", "development", "staging"]) {
    assert.deepEqual(buildPlan(environment), ["build"]);
  }
});

test("fails closed and never builds when production migration fails", () => {
  const calls = [];
  assert.throws(
    () =>
      runBuildPlan("production", (_command, args) => {
        calls.push(args);
        return { status: 1 };
      }),
    /db:migrate:deploy.*failed/i,
  );
  assert.deepEqual(calls, [["run", "db:migrate:deploy"]]);
});

test("runs the application build after a successful migration", () => {
  const calls = [];
  runBuildPlan("production", (command, args, options) => {
    calls.push({ command, args, options });
    return { status: 0 };
  });
  assert.deepEqual(
    calls.map((call) => call.args),
    [
      ["run", "db:migrate:deploy"],
      ["run", "build"],
    ],
  );
  assert.equal(
    calls[0].command,
    process.platform === "win32" ? "npm.cmd" : "npm",
  );
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.stdio, "inherit");
});

test("propagates spawn failures and treats signal termination as failure", () => {
  const spawnFailure = new Error("spawn failed");
  assert.throws(
    () =>
      runBuildPlan("preview", () => ({
        error: spawnFailure,
        status: null,
      })),
    spawnFailure,
  );
  assert.throws(
    () =>
      runBuildPlan("preview", () => ({
        status: null,
        signal: "SIGTERM",
      })),
    /exit code unknown/i,
  );
});
