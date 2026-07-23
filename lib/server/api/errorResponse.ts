import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { z } from "zod";

export function createRequestId(): string {
  return randomUUID();
}

/**
 * The one error envelope: `{ error: { code, message, details? }, requestId? }`.
 *
 * Every non-2xx body in `app/api` goes through here — asserted by
 * `test/api/routeSessionGuard.test.ts`. A client that has parsed one error
 * response has parsed them all.
 */
export function errorJson(
  code: string,
  message: string,
  status: number,
  options?: { details?: unknown; requestId?: string; headers?: HeadersInit },
): NextResponse {
  return NextResponse.json(
    {
      error: { code, message, ...(options?.details ? { details: options.details } : {}) },
      ...(options?.requestId ? { requestId: options.requestId } : {}),
    },
    { status, ...(options?.headers ? { headers: options.headers } : {}) },
  );
}

export function unauthorizedError(requestId?: string): NextResponse {
  return errorJson("UNAUTHORIZED", "Unauthorized", 401, { requestId });
}

export function notFoundError(entity: string, requestId?: string): NextResponse {
  return errorJson(`${entity.toUpperCase()}_NOT_FOUND`, `${entity} not found`, 404, { requestId });
}

export function validationError(zodError: z.ZodError, requestId?: string): NextResponse {
  return errorJson("INVALID_BODY", "Invalid request body", 400, {
    details: zodError.flatten(),
    requestId,
  });
}
