/**
 * The eval harness's only door into Joblit's own code.
 *
 * Two subcommands, both stdin JSON in / stdout JSON out, both pure:
 *
 *   build-prompt   { profile, job, target }        -> { system, user, chars }
 *   run-gates      { profile, job, target, raw }   -> { ok, ... } | { ok:false, error }
 *
 * Why a Node bridge rather than HTTP: the eval must judge generations with the
 * *same* validation code production runs, or it measures a different system.
 * Calling `acceptApplicationGeneration` in-process gives that for free, with no
 * session, no database write, and no DRAFT rows to clean up afterwards.
 *
 * Why a separate file from the Python runner: `tools/**\/*.mjs` is already a
 * knip entry point, so this lands without a dead-code exemption, and the Python
 * side stays outside the npm dependency allowlist entirely.
 */
import { readFileSync } from "node:fs";

import {
  buildV2SystemPrompt,
  buildV2ResumeUserPrompt,
  buildV2CoverUserPrompt,
} from "../../lib/server/ai/applicationPromptBuilder.ts";
import { buildResumePromptSnapshot } from "../../lib/server/ai/resumePromptSnapshot.ts";
import { DEFAULT_RULES } from "../../lib/server/ai/promptSkills.ts";
import { acceptApplicationGeneration } from "../../lib/server/applications/applicationGeneration.ts";
import { mapResumeProfile } from "../../lib/server/latex/mapResumeProfile.ts";

function readStdin() {
  return JSON.parse(readFileSync(0, "utf8"));
}

function buildPrompt({ profile, job, target }) {
  const rules = DEFAULT_RULES;
  const candidate = buildResumePromptSnapshot(profile);
  const promptInput = { target, rules, candidate, job };
  const system = buildV2SystemPrompt(rules);
  const user =
    target === "resume"
      ? buildV2ResumeUserPrompt(promptInput)
      : buildV2CoverUserPrompt(promptInput);
  return { system, user, chars: system.length + user.length };
}

function runGates({ profile, job, target, raw }) {
  return acceptApplicationGeneration({
    target,
    // The lenient dialect is what a pasted chatbot answer gets, and that is
    // what the sidecar produces too — evaluating under the strict dialect
    // would measure a path no user takes.
    source: "manual_import",
    rawOutput: raw,
    // Prompt-meta drift checking belongs to the API route; the harness always
    // builds the prompt it just sent, so there is nothing to drift against.
    promptMetaHash: "",
    master: mapResumeProfile(profile),
    profile,
    job: {
      title: job.title,
      company: job.company ?? null,
      description: job.description ?? null,
    },
  });
}

const HANDLERS = { "build-prompt": buildPrompt, "run-gates": runGates };

const command = process.argv[2];
const handler = HANDLERS[command];
if (!handler) {
  process.stderr.write(
    `usage: node joblitBridge.mjs <${Object.keys(HANDLERS).join("|")}> < input.json\n`,
  );
  process.exit(2);
}

try {
  process.stdout.write(JSON.stringify(handler(readStdin())));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
}
