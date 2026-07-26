import { NextResponse } from "next/server";
import { z } from "zod";

import { errorJson, unauthorizedError, validationError } from "@/lib/server/api/errorResponse";
import { checkRateLimit, rateLimitHeaders } from "@/lib/server/api/rateLimit";
import {
  ApplicationPromptError,
  ApplicationPromptRequestSchema,
  buildApplicationPromptForUser,
} from "@/lib/server/applications/applicationPrompt";
import {
  ExtensionTokenError,
  requireExtensionToken,
} from "@/lib/server/auth/requireExtensionToken";
import { issuePromptTailoringRun } from "@/lib/server/tailoringRuns/issuePromptTailoringRun";
import { TailoringRunError } from "@/lib/server/tailoringRuns/tailoringRunProtocol";

export const runtime = "nodejs";

const PROMPT_RATE_LIMIT = { limit: 20, windowSeconds: 60 } as const;
const ExtensionPromptRequestSchema = ApplicationPromptRequestSchema.extend({
  // Optional during the additive v1 rollout. Extension builds predating the
  // TailoringRun contract send only { jobId, target }; they keep receiving the
  // legacy prompt envelope and remain import-compatible until they upgrade.
  issueKey: z.string().uuid().optional(),
});

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function POST(req: Request) {
  let userId: string;
  let requestId: string;
  try {
    ({ userId, requestId } = await requireExtensionToken(req));
  } catch (error) {
    if (error instanceof ExtensionTokenError) {
      return noStore(unauthorizedError());
    }
    throw error;
  }

  const rateLimit = checkRateLimit(
    `ext:applications:prompt:${userId}`,
    PROMPT_RATE_LIMIT,
  );
  if (!rateLimit.allowed) {
    return errorJson("RATE_LIMITED", "Too many requests", 429, {
      headers: { ...rateLimitHeaders(rateLimit), "Cache-Control": "no-store" },
    });
  }

  const json = await req.json().catch(() => null);
  const parsed = ExtensionPromptRequestSchema.safeParse(json);
  if (!parsed.success) {
    return noStore(validationError(parsed.error, requestId));
  }

  try {
    const payload = await buildApplicationPromptForUser({
      userId,
      jobId: parsed.data.jobId,
      target: parsed.data.target,
      // The extension drives a local Hermes run; reasoning models stall on the
      // full prompt, so serve the lean variant here (cloud/manual stays full).
      variant: "lean",
    });
    const tailoringRun =
      parsed.data.target === "match" || !parsed.data.issueKey
        ? null
        : await issuePromptTailoringRun({
            userId,
            jobId: parsed.data.jobId,
            target: parsed.data.target,
            source: "LOCAL_AI",
            delivery: "DRAFT",
            issueKey: parsed.data.issueKey,
            payload,
          });
    return NextResponse.json(
      {
        ...payload,
        ...(tailoringRun ? { tailoringRun } : {}),
      },
      {
      headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    if (error instanceof ApplicationPromptError) {
      return noStore(
        errorJson(
          error.code === "INVALID_REQUEST" ? "INVALID_BODY" : error.code,
          error.message,
          error.status,
          { details: error.details, requestId },
        ),
      );
    }
    if (error instanceof TailoringRunError) {
      return noStore(
        errorJson(error.code, error.message, error.status, {
          requestId,
        }),
      );
    }
    throw error;
  }
}
