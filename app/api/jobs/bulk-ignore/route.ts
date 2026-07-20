import { NextResponse } from "next/server";
import { z } from "zod";

import { errorJson, unauthorizedError } from "@/lib/server/api/errorResponse";
import { checkRateLimit, rateLimitHeaders } from "@/lib/server/api/rateLimit";
import {
  requireSession,
  UnauthorizedError,
  type SessionContext,
} from "@/lib/server/auth/requireSession";
import { getCurrentFitSnapshotPredicates } from "@/lib/server/jobs/fitRunService";
import { prisma } from "@/lib/server/prisma";

export const runtime = "nodejs";

const BULK_RATE_LIMIT = { limit: 20, windowSeconds: 60 } as const;
const MaxScoreSchema = z.number().int().min(0).max(44).default(44);

// Ignore = move NEW -> REJECTED (reversible), never delete: deletion goes
// through DeletedJobUrl tombstones and would permanently block re-import.
const BodySchema = z.union([
  z
    .object({
      maxScore: MaxScoreSchema,
      preview: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      restoreIgnoredAt: z
        .string()
        .datetime({ offset: true })
        .transform((value) => new Date(value)),
      maxScore: MaxScoreSchema,
    })
    .strict(),
]);

export async function POST(req: Request) {
  let session: SessionContext;
  try {
    session = await requireSession();
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedError();
    throw err;
  }
  const { userId } = session;

  const rateLimit = checkRateLimit(`jobs:bulk-ignore:${userId}`, BULK_RATE_LIMIT);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: rateLimitHeaders(rateLimit) },
    );
  }

  const body = BodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return errorJson("INVALID_BODY", "Invalid request body", 400, {
      details: body.error.flatten(),
    });
  }

  if ("restoreIgnoredAt" in body.data) {
    const restored = await prisma.job.updateMany({
      where: {
        userId,
        status: "REJECTED",
        fitScore: { not: null, lte: body.data.maxScore },
        // The commit writes one exact timestamp to every row it moved. This
        // acts as a bounded, tenant-scoped operation marker without returning
        // an unbounded UUID array to the browser. Any later edit changes
        // updatedAt and intentionally opts that row out of undo.
        updatedAt: body.data.restoreIgnoredAt,
      },
      data: { status: "NEW" },
    });
    return NextResponse.json({ restored: restored.count });
  }

  const currentSnapshots = await getCurrentFitSnapshotPredicates(userId);
  if (currentSnapshots.length === 0) {
    if (body.data.preview) {
      return NextResponse.json({ count: 0 });
    }
    return NextResponse.json({ count: 0, ignoredAt: new Date().toISOString() });
  }

  // Only scored low-fit jobs qualify; unscored/failed jobs are never swept.
  const where = {
    userId,
    status: "NEW" as const,
    fitScore: { not: null, lte: body.data.maxScore },
    OR: currentSnapshots,
  };

  if (body.data.preview) {
    const count = await prisma.job.count({ where });
    return NextResponse.json({ count });
  }

  // One atomic statement changes the exact rows won by this request. A shared
  // updatedAt value is the undo marker, so this remains reversible at any
  // database size without sending thousands of job IDs over the wire.
  const ignoredAt = new Date();
  const ignored = await prisma.job.updateMany({
    where,
    data: { status: "REJECTED", updatedAt: ignoredAt },
  });
  return NextResponse.json({
    count: ignored.count,
    ignoredAt: ignoredAt.toISOString(),
  });
}
