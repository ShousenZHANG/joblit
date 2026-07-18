import { NextResponse } from "next/server";
import { z } from "zod";

import { errorJson, unauthorizedError } from "@/lib/server/api/errorResponse";
import { checkRateLimit, rateLimitHeaders } from "@/lib/server/api/rateLimit";
import {
  requireSession,
  UnauthorizedError,
  type SessionContext,
} from "@/lib/server/auth/requireSession";
import { prisma } from "@/lib/server/prisma";

export const runtime = "nodejs";

const BULK_RATE_LIMIT = { limit: 20, windowSeconds: 60 } as const;
const MAX_BULK_JOBS = 500;

// Ignore = move NEW -> REJECTED (reversible), never delete: deletion goes
// through DeletedJobUrl tombstones and would permanently block re-import.
const BodySchema = z.union([
  z
    .object({
      maxScore: z.number().int().min(0).max(44).default(44),
      preview: z.boolean().optional(),
    })
    .strict(),
  z
    .object({ restoreJobIds: z.array(z.string().uuid()).min(1).max(MAX_BULK_JOBS) })
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

  if ("restoreJobIds" in body.data) {
    const restored = await prisma.job.updateMany({
      where: { id: { in: body.data.restoreJobIds }, userId, status: "REJECTED" },
      data: { status: "NEW" },
    });
    return NextResponse.json({ restored: restored.count });
  }

  // Only scored low-fit jobs qualify; unscored/failed jobs are never swept.
  const where = {
    userId,
    status: "NEW" as const,
    fitScore: { not: null, lte: body.data.maxScore },
  };

  if (body.data.preview) {
    const count = await prisma.job.count({ where });
    return NextResponse.json({ count });
  }

  const targets = await prisma.job.findMany({
    where,
    select: { id: true },
    take: MAX_BULK_JOBS,
  });
  if (targets.length === 0) return NextResponse.json({ count: 0, jobIds: [] });

  const jobIds = targets.map((job) => job.id);
  await prisma.job.updateMany({
    where: { id: { in: jobIds }, userId, status: "NEW" },
    data: { status: "REJECTED" },
  });
  return NextResponse.json({ count: jobIds.length, jobIds });
}
