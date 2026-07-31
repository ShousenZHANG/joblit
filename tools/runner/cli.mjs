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
 *
 * Hermes recovery metadata is machine-local at
 * ~/.joblit/runner-state-v1.json. Local Runner processes coordinate through
 * its atomic .lock sidecar; the state file is not a cross-host data store.
 */

import { parseArgs } from "node:util";

import { loadConfig } from "./config.mjs";
import { processFitQueue } from "./fitQueue.mjs";
import { createHermesClient } from "./hermesClient.mjs";
import { createJoblitClient } from "./joblitClient.mjs";
import { createFileRunStateStore } from "./runStateStore.mjs";
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
  const shutdown = new AbortController();
  const requestShutdown = () => shutdown.abort();
  process.once("SIGINT", requestShutdown);
  process.once("SIGTERM", requestShutdown);
  const joblit = createJoblitClient({
    baseUrl: config.joblitUrl,
    token: config.joblitToken,
  });
  const hermes = createHermesClient({
    baseUrl: config.hermesUrl,
    apiKey: config.hermesKey,
    runStateStore: createFileRunStateStore(),
  });

  for (;;) {
    // Fit scanning first: triage is cheap and narrows what is worth tailoring.
    const fit = await processFitQueue({
      joblit,
      hermes,
      signal: shutdown.signal,
    });
    if (fit.scored > 0 || fit.failed > 0) {
      console.log(`Fit scan: ${fit.scored} scored, ${fit.failed} failed.`);
    }
    if (fit.stopped) console.log(`Fit scan stopped: ${fit.stopped}`);

    if (shutdown.signal.aborted) return;
    const summary = await processActiveBatch({
      joblit,
      hermes,
      signal: shutdown.signal,
    });
    if (summary.batchId) {
      console.log(
        `Batch ${summary.batchId}: ${summary.succeeded} succeeded, ${summary.failed} failed, ${summary.deferred} deferred.`,
      );
    }
    if (!values.watch || shutdown.signal.aborted) return;
    await sleep(WATCH_INTERVAL_MS);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
