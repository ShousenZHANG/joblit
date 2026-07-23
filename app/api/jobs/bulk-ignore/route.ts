import { NextResponse } from "next/server";
import { withSessionRoute } from "@/lib/server/api/routeHandler";
import { z } from "zod";

import { errorJson } from "@/lib/server/api/errorResponse";
import { checkRateLimit, rateLimitHeaders } from "@/lib/server/api/rateLimit";
import { getCurrentFitSnapshotPredicates } from "@/lib/server/jobs/fitRunService";
import { bulkAppendStatusEvents } from "@/lib/server/applications/applicationEvents";
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
  return withSessionRoute(async ({ userId }) => {
    const rateLimit = checkRateLimit(`jobs:bulk-ignore:${userId}`, BULK_RATE_LIMIT);
    if (!rateLimit.allowed) {
      return errorJson("RATE_LIMITED", "Too many requests", 429, {
        headers: rateLimitHeaders(rateLimit),
      });
    }

    const body = BodySchema.safeParse(await req.json().catch(() => null));
    if (!body.success) {
      return errorJson("INVALID_BODY", "Invalid request body", 400, {
        details: body.error.flatten(),
      });
    }

    if ("restoreIgnoredAt" in body.data) {
      const restored = await bulkAppendStatusEvents(userId, {
        where: {
          fitScore: { not: null, lte: body.data.maxScore },
          // One exact timestamp marks rows won by the original bulk operation.
          // A later edit changes updatedAt and intentionally opts out of undo.
          updatedAt: body.data.restoreIgnoredAt,
        },
        fromStatus: "REJECTED",
        toStatus: "NEW",
        source: "USER",
        note: "Restored jobs from low-fit bulk ignore",
        idempotencyPrefix: `bulk-ignore-undo:${body.data.restoreIgnoredAt.toISOString()}`,
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
    // updatedAt value is the undo marker. Matching immutable events are inserted
    // in the same transaction, so projection and history cannot diverge.
    const ignoredAt = new Date();
    const ignored = await bulkAppendStatusEvents(userId, {
      where,
      fromStatus: "NEW",
      toStatus: "REJECTED",
      source: "USER",
      note: `Bulk ignored roles with fit score at or below ${body.data.maxScore}`,
      idempotencyPrefix: `bulk-ignore:${ignoredAt.toISOString()}`,
      projectionUpdatedAt: ignoredAt,
    });
    return NextResponse.json({
      count: ignored.count,
      ignoredAt: ignoredAt.toISOString(),
    });
  });
}
