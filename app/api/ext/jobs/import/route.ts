import { NextResponse } from "next/server";
import { z } from "zod";
import { requireExtensionToken, ExtensionTokenError } from "@/lib/server/auth/requireExtensionToken";
import { unauthorizedError, errorJson } from "@/lib/server/api/errorResponse";
import { checkRateLimit, rateLimitKeyFromRequest, rateLimitHeaders } from "@/lib/server/api/rateLimit";
import { reportError } from "@/lib/server/observability/errorReporter";
import { ImportJobItemSchema, importJobsForUser } from "@/lib/server/jobs/jobImportService";

export const runtime = "nodejs";

// Browser-extension job ingestion (see ADR-0003). The extension scrapes a
// source the user is logged into (e.g. Seek) FROM THE USER'S OWN BROWSER —
// residential IP + real session — and POSTs the mapped rows here. The same
// importJobsForUser() the server-side fetcher uses applies tombstone filtering
// and (userId, jobUrl) dedupe, so extension imports can never resurrect a
// deleted job or duplicate an existing one.
const BodySchema = z.object({
  // Cap a single import to keep one request bounded; the extension pages
  // through larger result sets across multiple calls.
  items: z.array(ImportJobItemSchema).max(200).default([]),
});

export async function POST(req: Request) {
  const rl = checkRateLimit(rateLimitKeyFromRequest(req, "ext:jobs:import"), {
    limit: 30,
    windowSeconds: 60,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  try {
    const { userId } = await requireExtensionToken(req);
    const body = await req.json().catch(() => null);
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return errorJson("INVALID_BODY", "Invalid request body", 400, {
        details: parsed.error.flatten(),
      });
    }

    const { imported, invalid } = await importJobsForUser({
      userId,
      items: parsed.data.items,
    });
    return NextResponse.json({ data: { imported, invalid } });
  } catch (err) {
    if (err instanceof ExtensionTokenError) return unauthorizedError();
    reportError(err, { scope: "ext.jobs.import" });
    return errorJson("IMPORT_FAILED", "Could not import jobs", 500);
  }
}
