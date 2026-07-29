import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError } from "@/lib/server/api/appError";
import { errorJson } from "@/lib/server/api/errorResponse";
import { withExtensionRoute } from "@/lib/server/extensionIngress/withExtensionRoute";
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
  return withExtensionRoute(req, "jobs.import", async ({ userId, requestId }) => {
    const body = await req.json().catch(() => null);
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return errorJson("INVALID_BODY", "Invalid request body", 400, {
        details: parsed.error.flatten(),
        requestId,
      });
    }

    try {
      const { imported, invalid } = await importJobsForUser({
        userId,
        items: parsed.data.items,
      });
      return NextResponse.json({ data: { imported, invalid } });
    } catch (error) {
      throw new AppError({
        code: "IMPORT_FAILED",
        status: 500,
        publicMessage: "Could not import jobs",
        privateDetails: error,
        cause: error,
      });
    }
  });
}
