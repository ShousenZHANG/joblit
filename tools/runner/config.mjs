/**
 * Runner configuration: local connection settings plus product model policy.
 *
 * There is no model credential here any more. Generation runs through the
 * official Codex CLI, which holds its own login — the Runner never sees,
 * stores, or forwards an AI credential. Only the Joblit agent token is ours.
 */

import {
  JOBLIT_CODEX_MODEL,
  JOBLIT_CODEX_REASONING_EFFORT,
} from "./modelPolicy.mjs";

const REQUIRED = ["JOBLIT_URL", "JOBLIT_TOKEN"];

function readValue(env, name) {
  const raw = env[name];
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function loadConfig(env) {
  const missing = REQUIRED.filter((name) => readValue(env, name) === undefined);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. ` +
        "Issue JOBLIT_TOKEN from the Runner setup popover in the Joblit nav, " +
        "then sign in to the model with: codex login",
    );
  }

  return {
    joblitUrl: readValue(env, "JOBLIT_URL"),
    joblitToken: readValue(env, "JOBLIT_TOKEN"),
    /** Product policy: ambient shell or user config cannot silently downgrade generation. */
    codexModel: JOBLIT_CODEX_MODEL,
    codexReasoningEffort: JOBLIT_CODEX_REASONING_EFFORT,
    /** Optional: override the executable, e.g. an absolute path. */
    codexBinary: readValue(env, "CODEX_BIN") ?? "codex",
  };
}
