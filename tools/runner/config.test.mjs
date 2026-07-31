import assert from "node:assert/strict";
import test from "node:test";

import { loadConfig } from "./config.mjs";

const FULL_ENV = {
  JOBLIT_URL: "https://joblit.example.com",
  JOBLIT_TOKEN: "agent-token",
  HERMES_URL: "http://127.0.0.1:9999",
  HERMES_KEY: "local-key",
};

test("loads a complete configuration from env", () => {
  const config = loadConfig(FULL_ENV);
  assert.deepEqual(config, {
    joblitUrl: "https://joblit.example.com",
    joblitToken: "agent-token",
    hermesUrl: "http://127.0.0.1:9999",
    hermesKey: "local-key",
  });
});

test("HERMES_URL defaults to the gateway's standard loopback port", () => {
  const { HERMES_URL: _omitted, ...env } = FULL_ENV;
  const config = loadConfig(env);
  assert.equal(config.hermesUrl, "http://127.0.0.1:8642");
});

test("names every missing variable at once, not one per run", () => {
  assert.throws(
    () => loadConfig({ HERMES_URL: "http://127.0.0.1:8642" }),
    (error) => {
      assert.match(error.message, /JOBLIT_URL/);
      assert.match(error.message, /JOBLIT_TOKEN/);
      assert.match(error.message, /HERMES_KEY/);
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
