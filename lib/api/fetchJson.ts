/**
 * Client-side fetch helper that consolidates the repeated:
 *
 *   const res = await fetch(url, init);
 *   const json = await res.json().catch(() => ({}));
 *   if (!res.ok) throw new Error(json?.error?.message ?? "Failed");
 *   return json as T;
 *
 * pattern from 9+ hooks and components.
 *
 * Optional Zod schema validates the success payload at the seam so
 * downstream code is statically typed without manual `as` casts.
 */

import type { ZodType } from "zod";

export class ApiError extends Error {
  readonly status: number;
  /**
   * The server's error code, e.g. `STALE_WRITE`. Null only when the response
   * did not come from `app/api` — every route there returns the envelope, which
   * `test/api/routeSessionGuard.test.ts` asserts.
   */
  readonly code: string | null;
  /** The envelope's `details`, if any. Shape is per-code. */
  readonly details: unknown;
  /** The whole parsed body, for the rare consumer that needs more. */
  readonly payload: unknown;

  constructor(status: number, message: string, payload?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
    const envelope = readEnvelope(payload);
    this.code = envelope?.code ?? null;
    this.details = envelope?.details;
  }
}

function readEnvelope(
  payload: unknown,
): { code?: string; message?: string; details?: unknown } | null {
  if (!payload || typeof payload !== "object") return null;
  const error = (payload as Record<string, unknown>).error;
  if (!error || typeof error !== "object") return null;
  const inner = error as Record<string, unknown>;
  return {
    code: typeof inner.code === "string" ? inner.code : undefined,
    message: typeof inner.message === "string" ? inner.message : undefined,
    details: inner.details,
  };
}

interface FetchJsonOptions<TSchema extends ZodType | undefined = undefined>
  extends RequestInit {
  /** Optional Zod schema to validate the success body. */
  schema?: TSchema;
  /** Override the default error fallback text. */
  fallbackError?: string;
}

type Inferred<TSchema> = TSchema extends ZodType<infer Out> ? Out : unknown;

/**
 * Fetch JSON from `url`. Throws `ApiError` on non-2xx; throws regular
 * `Error` if the response cannot be parsed as JSON. Optionally validates
 * the success body against a Zod schema.
 */
export async function fetchJson<TSchema extends ZodType | undefined = undefined>(
  url: string,
  options: FetchJsonOptions<TSchema> = {},
): Promise<Inferred<TSchema>> {
  const { schema, fallbackError = "Request failed", ...init } = options;

  const headers = new Headers(init.headers);
  if (init.body != null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(url, { ...init, headers });
  const raw: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    throw new ApiError(res.status, extractErrorMessage(raw, fallbackError), raw);
  }

  if (schema) {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new ApiError(res.status, "Response shape invalid", parsed.error);
    }
    return parsed.data as Inferred<TSchema>;
  }

  return raw as Inferred<TSchema>;
}

/**
 * Read the message out of the Joblit error envelope.
 *
 * Routes outside `app/api` — NextAuth's handler, a proxy, an upstream CDN —
 * are not bound by the envelope, so a bare `message` and a raw string body are
 * still accepted. The legacy `error: "CODE"` branch is gone: no route emits it,
 * and keeping it meant a body with `{error:{code}}` and no message rendered as
 * `[object Object]`.
 */
function extractErrorMessage(payload: unknown, fallback: string): string {
  if (payload == null) return fallback;
  if (typeof payload === "string") return payload;
  if (typeof payload !== "object") return fallback;

  const envelope = readEnvelope(payload);
  if (envelope?.message) return envelope.message;

  const obj = payload as Record<string, unknown>;
  if (typeof obj.message === "string") return obj.message;
  return fallback;
}
