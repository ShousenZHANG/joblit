import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { reportError } from "@/lib/server/observability/errorReporter";
import { constantTimeEqual } from "@/lib/server/auth/constantTimeEqual";
import { ImportJobItemSchema, importJobsForUser } from "@/lib/server/jobs/jobImportService";

export const runtime = "nodejs";

const BodySchema = z.object({
  userEmail: z.string().email(),
  items: z.array(ImportJobItemSchema).default([]),
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
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }

    const json = await req.json().catch(() => null);
    const parsed = BodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "INVALID_BODY", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const email = parsed.data.userEmail.trim().toLowerCase();
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (!user) {
      return NextResponse.json({ error: "USER_NOT_FOUND" }, { status: 404 });
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
    return NextResponse.json({ error: "IMPORT_FAILED" }, { status: 500 });
  }
}
