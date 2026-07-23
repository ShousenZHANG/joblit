import { NextResponse } from "next/server";

import { errorJson, unauthorizedError, validationError } from "@/lib/server/api/errorResponse";
import { checkRateLimit, rateLimitHeaders } from "@/lib/server/api/rateLimit";
import {
  ApplicationPromptError,
  buildTriagePromptForUser,
  TriagePromptRequestSchema,
} from "@/lib/server/applications/applicationPrompt";
import {
  ExtensionTokenError,
  requireExtensionToken,
} from "@/lib/server/auth/requireExtensionToken";

export const runtime = "nodejs";

const TRIAGE_RATE_LIMIT = { limit: 20, windowSeconds: 60 } as const;

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

  const rateLimit = checkRateLimit(`ext:jobs:triage-prompt:${userId}`, TRIAGE_RATE_LIMIT);
  if (!rateLimit.allowed) {
    return errorJson("RATE_LIMITED", "Too many requests", 429, {
      headers: { ...rateLimitHeaders(rateLimit), "Cache-Control": "no-store" },
    });
  }

  const json = await req.json().catch(() => null);
  const parsed = TriagePromptRequestSchema.safeParse(json);
  if (!parsed.success) {
    return noStore(validationError(parsed.error, requestId));
  }

  try {
    const payload = await buildTriagePromptForUser({
      userId,
      jobIds: parsed.data.jobIds,
    });
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store" },
    });
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
    throw error;
  }
}
