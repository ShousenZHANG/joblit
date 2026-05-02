import type { NextResponse } from "next/server";
import type { z } from "zod";
import {
  requireSession,
  requireSessionWithEmail,
  UnauthorizedError,
  type SessionContext,
  type SessionContextWithEmail,
} from "@/lib/server/auth/requireSession";
import { unauthorizedError, validationError } from "@/lib/server/api/errorResponse";

type SessionRouteHandler<TContext extends SessionContext> = (
  context: TContext,
) => Promise<NextResponse>;

export async function withSessionRoute(
  handler: SessionRouteHandler<SessionContext>,
): Promise<NextResponse> {
  try {
    return await handler(await requireSession());
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedError();
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
    throw err;
  }
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
