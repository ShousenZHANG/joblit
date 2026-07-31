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
    throw err;
  }
}

/**
 * The agent seam: one handler, two identities.
 *
 * The batch protocol — create, claim, prompt, import — sat behind the browser
 * session only, so its documented external worker (Codex, and now the local
 * Runner) had no first-class way in; AGENTS.md never even had an auth section.
 * A request carrying `Authorization: Bearer` is judged as an ExtensionToken
 * holder; one without falls back to the session cookie. Both produce the same
 * `SessionContext`, so handlers cannot tell the difference and need no
 * changes.
 *
 * A presented token is judged as a token, never rescued by a cookie: falling
 * back would let a revoked token keep working from a signed-in browser, which
 * defeats revocation.
 */
export async function withAgentRoute<TParams>(
  req: Request,
  handler: SessionRouteHandler<SessionContext & { params: TParams }>,
  options: SessionRouteParams<TParams>,
): Promise<NextResponse>;
export async function withAgentRoute(
  req: Request,
  handler: SessionRouteHandler<SessionContext>,
): Promise<NextResponse>;
export async function withAgentRoute(
  req: Request,
  handler: (context: never) => Promise<NextResponse>,
  options?: SessionRouteParams<unknown>,
): Promise<NextResponse> {
  const run = handler as (
    context: SessionContext & { params?: unknown },
  ) => Promise<NextResponse>;
  const hasBearer = Boolean(req.headers.get("Authorization"));

  let session: SessionContext;
  try {
    if (hasBearer) {
      // Lazily loaded: the token validator imports prisma at module scope, and
      // a static import here would drag the database into every route's module
      // graph — including session-only routes and their tests.
      const { requireExtensionToken } = await import(
        "@/lib/server/auth/requireExtensionToken"
      );
      const token = await requireExtensionToken(req);
      session = { userId: token.userId, requestId: token.requestId };
    } else {
      session = await requireSession();
    }
  } catch (err) {
    if (
      err instanceof UnauthorizedError ||
      (err instanceof Error && err.name === "ExtensionTokenError")
    ) {
      return unauthorizedError();
    }
    reportError(err, { scope: "route.agent" });
    throw err;
  }

  try {
    if (!options) return await run(session);
    const parsed = options.schema.safeParse(await options.params);
    if (!parsed.success) return invalidParamsError(session.requestId);
    return await run({ ...session, params: parsed.data });
  } catch (err) {
    const typed = toErrorResponse(err, session.requestId);
    if (typed) return typed;
    reportError(err, { scope: "route.agent", requestId: session.requestId });
    throw err;
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
