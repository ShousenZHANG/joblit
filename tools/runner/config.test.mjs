import assert from "node:assert/strict";
import test from "node:test";

import { loadConfig } from "./config.mjs";

const FULL_ENV = {
  JOBLIT_URL: "https://joblit.example.com",
  JOBLIT_TOKEN: "agent-token",
};

test("loads a complete configuration from env", () => {
  const config = loadConfig(FULL_ENV);
  assert.deepEqual(config, {
    joblitUrl: "https://joblit.example.com",
    joblitToken: "agent-token",
    codexModel: undefined,
    codexBinary: "codex",
  });
});

test("carries optional Codex overrides through", () => {
  const config = loadConfig({
    ...FULL_ENV,
    CODEX_MODEL: "gpt-5.6-terra",
    CODEX_BIN: "/opt/codex/bin/codex",
  });
  assert.equal(config.codexModel, "gpt-5.6-terra");
  assert.equal(config.codexBinary, "/opt/codex/bin/codex");
});

test("asks for no model credential — Codex holds its own login", () => {
  // The Runner must never require an AI key. A configuration that loads
  // without one is the enforcement of that boundary.
  const config = loadConfig(FULL_ENV);
  const serialized = JSON.stringify(config).toLowerCase();
  assert.ok(!serialized.includes("key"));
  assert.ok(!serialized.includes("secret"));
});

test("names every missing variable at once, not one per run", () => {
  assert.throws(
    () => loadConfig({}),
    (error) => {
      assert.match(error.message, /JOBLIT_URL/);
      assert.match(error.message, /JOBLIT_TOKEN/);
      assert.match(error.message, /codex login/);
      return true;
    },
  );
});

test("treats a blank value as missing", () => {
  assert.throws(
    () => loadConfig({ ...FULL_ENV, JOBLIT_TOKEN: "   " }),
    /JOBLIT_TOKEN/,
  );
});
