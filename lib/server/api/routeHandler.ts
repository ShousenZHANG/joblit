import type { NextResponse } from "next/server";
import type { z } from "zod";
import {
  requireSession,
  requireSessionWithEmail,
  UnauthorizedError,
  type SessionContext,
  type SessionContextWithEmail,
} from "@/lib/server/auth/requireSession";
import {
  errorJson,
  unauthorizedError,
  validationError,
} from "@/lib/server/api/errorResponse";
import { toErrorResponse } from "@/lib/server/api/appError";
import { reportError } from "@/lib/server/observability/errorReporter";

type SessionRouteHandler<TContext extends SessionContext> = (
  context: TContext,
) => Promise<NextResponse>;

/**
 * Route params validated before the handler runs.
 *
 * Dynamic segments arrive as `Promise<Record<string, string>>` from Next. Pass
 * that promise and a schema; the handler receives the parsed value and never
 * sees an unvalidated id.
 */
export type SessionRouteParams<TParams> = {
  params: Promise<unknown>;
  schema: z.ZodType<TParams>;
};

/**
 * The session seam for every authenticated route.
 *
 * Guarantees, in this order: a session exists (401 otherwise), route params
 * parse against the supplied schema (400 otherwise), and any other throw is
 * reported through the observability seam before it bubbles to Next's 500.
 * That last guarantee is the reason to use this rather than an inline
 * `try/catch (UnauthorizedError)` — the two look equivalent and are not.
 */
/**
 * The answer for a bug: a coded envelope, never a rethrow.
 *
 * Rethrowing handed the request to Next, which replies 500 with no body — no
 * error code, no requestId, nothing to correlate against a log line. To the
 * Runner that is indistinguishable from a lost connection, so it replays the
 * receipt, defers, and the batch stalls. Every server-side bug therefore
 * presented as the same anonymous outage.
 *
 * The status stays 500 because an unexpected throw genuinely may have
 * committed something; only the shape changes, so the failure can be found.
 */
function unexpectedErrorResponse(requestId: string) {
  return errorJson(
    "UNEXPECTED_ERROR",
    "Something went wrong on our side. Please try again.",
    500,
    { requestId },
  );
}

export async function withSessionRoute<TParams>(
  handler: SessionRouteHandler<SessionContext & { params: TParams }>,
  options: SessionRouteParams<TParams>,
): Promise<NextResponse>;
export async function withSessionRoute(
  handler: SessionRouteHandler<SessionContext>,
): Promise<NextResponse>;
export async function withSessionRoute(
  handler: (context: never) => Promise<NextResponse>,
  options?: SessionRouteParams<unknown>,
): Promise<NextResponse> {
  const run = handler as (context: SessionContext & { params?: unknown }) => Promise<NextResponse>;
  let session: SessionContext;
  try {
    session = await requireSession();
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedError();
    reportError(err, { scope: "route.session" });
    throw err;
  }

  try {
    if (!options) return await run(session);
    const parsed = options.schema.safeParse(await options.params);
    if (!parsed.success) return invalidParamsError(session.requestId);
    return await run({ ...session, params: parsed.data });
  } catch (err) {
    // A typed domain failure renders as the canonical envelope. Anything else
    // is a bug: capture it via the seam before it bubbles to Next's 500 so it
    // isn't invisible in prod.
    const typed = toErrorResponse(err, session.requestId);
    if (typed) return typed;
    reportError(err, { scope: "route.session", requestId: session.requestId });
    return unexpectedErrorResponse(session.requestId);
  }
}

export async function withEmailSessionRoute(
  handler: SessionRouteHandler<SessionContextWithEmail>,
): Promise<NextResponse> {
  try {
    return await handler(await requireSessionWithEmail());
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedError();
    reportError(err, { scope: "route.emailSession" });
    throw err;
  }
}

export function invalidParamsError(requestId?: string): NextResponse {
  return errorJson("INVALID_PARAMS", "Invalid route parameters", 400, { requestId });
}

export async function parseJsonBody<TSchema extends z.ZodType>(
  req: Request,
  schema: TSchema,
  requestId?: string,
): Promise<
  | { ok: true; data: z.infer<TSchema> }
  | { ok: false; response: NextResponse }
> {
  const json = await req.json().catch(() => null);
  return parseJsonValue(json, schema, requestId);
}

export function parseJsonValue<TSchema extends z.ZodType>(
  json: unknown,
  schema: TSchema,
  requestId?: string,
):
  | { ok: true; data: z.infer<TSchema> }
  | { ok: false; response: NextResponse } {
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, response: validationError(parsed.error, requestId) };
  }
  return { ok: true, data: parsed.data };
}
