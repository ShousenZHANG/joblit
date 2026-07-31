/**
 * Runner configuration. Everything comes from the local environment — the
 * Hermes key in particular is a local credential that must never be stored
 * server-side; the Runner reads it here and sends it only to the loopback
 * gateway (enforced by hermesClient).
 */

const HERMES_DEFAULT_URL = "http://127.0.0.1:8642";

const REQUIRED = ["JOBLIT_URL", "JOBLIT_TOKEN", "HERMES_KEY"];

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
        "Issue JOBLIT_TOKEN from the Joblit extension page; HERMES_KEY comes from your local Hermes gateway.",
    );
  }

  return {
    joblitUrl: readValue(env, "JOBLIT_URL"),
    joblitToken: readValue(env, "JOBLIT_TOKEN"),
    hermesUrl: readValue(env, "HERMES_URL") ?? HERMES_DEFAULT_URL,
    hermesKey: readValue(env, "HERMES_KEY"),
  };
}
