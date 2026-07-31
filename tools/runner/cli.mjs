#!/usr/bin/env node
/**
 * Joblit Runner entry point.
 *
 * Usage:
 *   node tools/runner/cli.mjs            # drain the active batch once, exit
 *   node tools/runner/cli.mjs --watch    # keep polling for new batches
 *
 * Environment: JOBLIT_URL, JOBLIT_TOKEN, HERMES_KEY (required);
 * HERMES_URL (optional, defaults to http://127.0.0.1:8642).
 */

import { parseArgs } from "node:util";

import { loadConfig } from "./config.mjs";
import { createHermesClient } from "./hermesClient.mjs";
import { createJoblitClient } from "./joblitClient.mjs";
import { processActiveBatch } from "./runner.mjs";

const WATCH_INTERVAL_MS = 30_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const { values } = parseArgs({
    options: {
      watch: { type: "boolean", default: false },
    },
  });

  const config = loadConfig(process.env);
  const joblit = createJoblitClient({
    baseUrl: config.joblitUrl,
    token: config.joblitToken,
  });
  const hermes = createHermesClient({
    baseUrl: config.hermesUrl,
    apiKey: config.hermesKey,
  });

  for (;;) {
    const summary = await processActiveBatch({ joblit, hermes });
    if (summary.batchId) {
      console.log(
        `Batch ${summary.batchId}: ${summary.succeeded} succeeded, ${summary.failed} failed.`,
      );
    }
    if (!values.watch) return;
    await sleep(WATCH_INTERVAL_MS);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
