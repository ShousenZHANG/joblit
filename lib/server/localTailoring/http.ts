import { NextResponse } from "next/server";
import type { z } from "zod";
import { AppError, toErrorResponse } from "@/lib/server/api/appError";
import { createRequestId, errorJson, validationError } from "@/lib/server/api/errorResponse";
import { withSessionRoute } from "@/lib/server/api/routeHandler";
import { reportError } from "@/lib/server/observability/errorReporter";
import { taskIdSchema, type TaskAccess } from "./contract";

export function localTaskJson(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { "cache-control": "no-store" } });
}

export function assertLocalTaskSessionOrigin(req: Request) {
  const origin = req.headers.get("origin");
  const site = req.headers.get("sec-fetch-site");
  if ((origin && origin !== new URL(req.url).origin) || (!origin && (site === "cross-site" || site === "same-site"))) {
    throw new AppError({ code: "LOCAL_TASK_ORIGIN_REJECTED", status: 403, publicMessage: "Start this action from Joblit." });
  }
}

export async function localTaskBody<T>(req: Request, schema: z.ZodType<T>, limit = 340_000): Promise<T> {
  const reader = req.body?.getReader();
  let text = "";
  let bytes = 0;
  const decoder = new TextDecoder();
  if (reader) {
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > limit) {
          await reader.cancel();
          throw new AppError({ code: "LOCAL_TASK_BODY_TOO_LARGE", status: 413, publicMessage: "The local task request is too large." });
        }
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
    } finally { reader.releaseLock(); }
  }
  let value: unknown;
  try { value = text ? JSON.parse(text) : {}; } catch { value = null; }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AppError({ code: "INVALID_BODY", status: 400, publicMessage: "Invalid local task request.", publicDetails: parsed.error.flatten() });
  return parsed.data;
}

export function withLocalTaskRoute(req: Request, ctx: { params: Promise<{ id: string }> }, handler: (input: { id: string; access: TaskAccess; requestId: string }) => Promise<NextResponse>, allowSession = false) {
  if (allowSession && !req.headers.has("authorization")) {
    return withSessionRoute(async ({ userId, requestId, params }) => {
      if (req.method !== "GET") assertLocalTaskSessionOrigin(req);
      return handler({ id: params.id, access: { userId }, requestId });
    }, { params: ctx.params, schema: taskIdSchema });
  }
  return (async () => {
    const requestId = createRequestId();
    try {
      const parsed = taskIdSchema.safeParse(await ctx.params);
      if (!parsed.success) return validationError(parsed.error, requestId);
      const authorization = req.headers.get("authorization") ?? "";
      const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization);
      if (!match) return errorJson("LOCAL_TASK_UNAUTHORIZED", "A task capability is required.", 401, { requestId });
      return await handler({ id: parsed.data.id, access: { capability: match[1] }, requestId });
    } catch (error) {
      const known = toErrorResponse(error, requestId);
      if (known) return known;
      reportError(error, { scope: "local-tailoring.route", requestId });
      return errorJson("LOCAL_TASK_ERROR", "The task could not be updated. Check its status before retrying.", 500, { requestId });
    }
  })();
}
