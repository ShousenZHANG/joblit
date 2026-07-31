import { z } from "zod";

// Startup env validation. Imported from instrumentation.ts's register() in the
// Node.js runtime so a misconfigured deploy fails fast at boot with a clear
// message, instead of 500-ing mid-request (e.g. auth.ts reading an empty OAuth
// secret). Validation is intentionally LENIENT — non-empty strings, not strict
// formats — so it never blocks a valid deploy and the CI build (which sets
// dummy placeholder envs) still passes. Optional integrations are optional.

const nonEmpty = z.string().min(1);

const serverEnvSchema = z.object({
  // Core — required for the app to function at all.
  DATABASE_URL: nonEmpty,
  AUTH_SECRET: nonEmpty,
  APP_ENC_KEY: nonEmpty,
  FETCH_RUN_SECRET: nonEmpty,
  LATEX_RENDER_URL: z.string().url(),
  LATEX_RENDER_TOKEN: nonEmpty,
  // OAuth providers.
  GOOGLE_CLIENT_ID: nonEmpty,
  GOOGLE_CLIENT_SECRET: nonEmpty,
  GITHUB_ID: nonEmpty,
  GITHUB_SECRET: nonEmpty,
  // Optional integrations — present in some deploys only. Declared optional so
  // their absence is never a boot failure.
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().optional(),
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
  YOUTUBE_API_KEY: z.string().optional(),
  CRON_SECRET: z.string().optional(),
  GITHUB_OWNER: z.string().optional(),
  GITHUB_REPO: z.string().optional(),
  GITHUB_TOKEN: z.string().optional(),
  GITHUB_WORKFLOW_FILE: z.string().optional(),
  GITHUB_REF: z.string().optional(),
  JOBLIT_WEB_URL: z.string().optional(),
  NEXTAUTH_URL: z.string().optional(),
  ENABLE_BATCH_EXECUTE_AUTOGEN: z
    .enum(["", "0", "1", "false", "true"])
    .optional(),
  ARTIFACT_RECONCILE_ENABLED: z
    .enum(["", "0", "1", "false", "true"])
    .optional(),
  ARTIFACT_RECONCILE_SECRET: z.string().optional(),
  UPSTASH_REDIS_REST_URL: z.string().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
  KV_REST_API_URL: z.string().optional(),
  KV_REST_API_TOKEN: z.string().optional(),
  JOBLIT_ATS_BOARDS_JSON: z.string().optional(),

  // Set to "true" only when the LaTeX renderer is reachable over plain HTTP.
  // The render token travels in a request header, so this puts a credential on
  // the wire in cleartext; it exists for a self-hosted renderer that has not
  // been fronted with TLS yet. Absent or anything else, HTTPS stays mandatory.
  LATEX_RENDER_ALLOW_INSECURE_HTTP: z
    .enum(["", "false", "true"])
    .optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let validated: ServerEnv | null = null;

/**
 * Parse + validate process.env against the server schema. Throws with the list
 * of offending keys on failure. Caches the result so repeated calls are cheap.
 */
export function validateServerEnv(): ServerEnv {
  if (validated) return validated;
  const result = serverEnvSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid server environment configuration — ${issues}`);
  }
  validated = result.data;
  return validated;
}
