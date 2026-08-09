/**
 * Runner configuration, all from the local environment.
 *
 * There is no model credential here any more. Generation runs through the
 * official Codex CLI, which holds its own login — the Runner never sees,
 * stores, or forwards an AI credential. Only the Joblit agent token is ours.
 */

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
    /** Optional: pin a model. Unset means the Codex CLI's own default. */
    codexModel: readValue(env, "CODEX_MODEL"),
    /** Optional: override the executable, e.g. an absolute path. */
    codexBinary: readValue(env, "CODEX_BIN") ?? "codex",
  };
}
