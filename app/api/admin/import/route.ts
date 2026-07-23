import { NextResponse } from "next/server";
import { errorJson } from "@/lib/server/api/errorResponse";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { reportError } from "@/lib/server/observability/errorReporter";
import { constantTimeEqual } from "@/lib/server/auth/constantTimeEqual";
import { ImportJobItemSchema, importJobsForUser } from "@/lib/server/jobs/jobImportService";

export const runtime = "nodejs";

const BodySchema = z.object({
  userEmail: z.string().email(),
  items: z.array(ImportJobItemSchema).max(200).default([]),
});

function requireImportSecret(req: Request) {
  const expected = process.env.IMPORT_SECRET;
  if (!expected) {
    throw new Error("IMPORT_SECRET is not set");
  }
  const got = req.headers.get("x-import-secret");
  return constantTimeEqual(got, expected);
}

export async function POST(req: Request) {
  try {
    if (!requireImportSecret(req)) {
      return errorJson("UNAUTHORIZED", "Unauthorized", 401);
    }

    const json = await req.json().catch(() => null);
    const parsed = BodySchema.safeParse(json);
    if (!parsed.success) {
      return errorJson("INVALID_BODY", "Invalid request body", 400, {
        details: parsed.error.flatten(),
      });
    }

    const email = parsed.data.userEmail.trim().toLowerCase();
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (!user) {
      return errorJson("USER_NOT_FOUND", "User not found", 404);
    }

    const { imported, invalid } = await importJobsForUser({
      userId: user.id,
      items: parsed.data.items,
    });
    return NextResponse.json({ ok: true, imported, invalid });
  } catch (err: unknown) {
    // Log the real cause server-side; return a generic message so DB /
    // stack internals never reach the client.
    reportError(err, { scope: "admin.import" });
    return errorJson("IMPORT_FAILED", "Import failed", 500);
  }
}
