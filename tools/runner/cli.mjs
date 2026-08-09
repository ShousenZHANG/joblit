#!/usr/bin/env node
/**
 * Joblit Runner entry point.
 *
 * Usage:
 *   node tools/runner/cli.mjs            # drain the active batch once, exit
 *   node tools/runner/cli.mjs --watch    # keep polling for new batches
 *
 * Environment: JOBLIT_URL and JOBLIT_TOKEN (required); CODEX_BIN (optional).
 *
 * Generation runs through the official Codex CLI as a subprocess, on the
 * credential `codex login` already stored. Nothing about a run outlives the
 * process, so there is no local recovery state to reconcile: an interrupted
 * generation simply produced nothing and is retried.
 */

import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { loadConfig } from "./config.mjs";
import { createCodexClient } from "./codexClient.mjs";
import { createJoblitClient } from "./joblitClient.mjs";
import { processActiveBatch } from "./runner.mjs";

export const WATCH_INTERVAL_MS = 5_000;

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
    reasoningEffort: config.codexReasoningEffort,
  });

  console.log(
    `Codex model: ${config.codexModel} · reasoning: ${config.codexReasoningEffort}`,
  );

  await runRunnerLoop({
    watch: values.watch,
    joblit,
    model,
    signal: shutdown.signal,
  });
}

/**
 * Run one or more tailoring-batch cycles. Dependencies are injectable to keep
 * the public loop behavior testable without starting a subprocess or touching
 * a real Joblit deployment.
 */
export async function runRunnerLoop({
  watch,
  joblit,
  model,
  signal,
  runApplicationBatch = processActiveBatch,
  wait = sleep,
  log = console.log,
}) {
  for (;;) {
    const summary = await runApplicationBatch({
      joblit,
      hermes: model,
      signal,
    });
    if (summary.batchId) {
      log(
        `Batch ${summary.batchId}: ${summary.succeeded} succeeded, ${summary.failed} failed, ${summary.deferred} deferred.`,
      );
    }


    if (!watch || signal?.aborted) return;
    await wait(WATCH_INTERVAL_MS);
    if (signal?.aborted) return;
  }
}

const entryPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (entryPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
