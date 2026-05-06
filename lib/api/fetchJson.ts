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
  readonly payload: unknown;

  constructor(status: number, message: string, payload?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

export interface FetchJsonOptions<TSchema extends ZodType | undefined = undefined>
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
 * Extract a string error message from an unknown payload. Handles the
 * Joblit error envelope (`error.message`), legacy `error: string`, and
 * raw string bodies.
 */
function extractErrorMessage(payload: unknown, fallback: string): string {
  if (payload == null) return fallback;
  if (typeof payload === "string") return payload;
  if (typeof payload !== "object") return fallback;

  const obj = payload as Record<string, unknown>;
  if (typeof obj.error === "string") return obj.error;
  if (obj.error && typeof obj.error === "object") {
    const inner = obj.error as Record<string, unknown>;
    if (typeof inner.message === "string") return inner.message;
  }
  if (typeof obj.message === "string") return obj.message;
  return fallback;
}
