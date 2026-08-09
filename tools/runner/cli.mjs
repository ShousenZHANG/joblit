#!/usr/bin/env node
/**
 * Joblit Runner entry point.
 *
 * Usage:
 *   node tools/runner/cli.mjs            # drain the active batch once, exit
 *   node tools/runner/cli.mjs --watch    # keep polling for new batches
 *
 * Environment: JOBLIT_URL, JOBLIT_TOKEN (required); CODEX_MODEL and
 * CODEX_BIN (optional).
 *
 * Generation runs through the official Codex CLI as a subprocess, on the
 * credential `codex login` already stored. Nothing about a run outlives the
 * process, so there is no local recovery state to reconcile: an interrupted
 * generation simply produced nothing and is retried.
 */

import { parseArgs } from "node:util";

import { loadConfig } from "./config.mjs";
import { processFitQueue } from "./fitQueue.mjs";
import { createCodexClient } from "./codexClient.mjs";
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
  const shutdown = new AbortController();
  const requestShutdown = () => shutdown.abort();
  process.once("SIGINT", requestShutdown);
  process.once("SIGTERM", requestShutdown);
  const joblit = createJoblitClient({
    baseUrl: config.joblitUrl,
    token: config.joblitToken,
  });
  const model = createCodexClient({
    binary: config.codexBinary,
    model: config.codexModel,
  });

  for (;;) {
    // Fit scanning first: triage is cheap and narrows what is worth tailoring.
    const fit = await processFitQueue({
      joblit,
      hermes: model,
      signal: shutdown.signal,
    });
    if (fit.scored > 0 || fit.failed > 0) {
      console.log(`Fit scan: ${fit.scored} scored, ${fit.failed} failed.`);
    }
    if (fit.stopped) console.log(`Fit scan stopped: ${fit.stopped}`);

    if (shutdown.signal.aborted) return;
    const summary = await processActiveBatch({
      joblit,
      hermes: model,
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
