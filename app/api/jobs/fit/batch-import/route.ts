import { NextResponse } from "next/server";
import { z } from "zod";

import { errorJson, unauthorizedError } from "@/lib/server/api/errorResponse";
import { checkRateLimit, rateLimitHeaders } from "@/lib/server/api/rateLimit";
import {
  requireSession,
  UnauthorizedError,
  type SessionContext,
} from "@/lib/server/auth/requireSession";
import { verdictForScore } from "@/lib/server/ai/fitScoring";
import { fitClaimSource } from "@/lib/server/jobs/fitRunService";
import { prisma } from "@/lib/server/prisma";

export const runtime = "nodejs";

const BATCH_RATE_LIMIT = { limit: 30, windowSeconds: 60 } as const;
const MAX_MODEL_OUTPUT_CHARS = 80_000;

const BodySchema = z
  .object({
    jobIds: z.array(z.string().uuid()).min(1).max(15),
    claimToken: z.string().uuid(),
    modelOutput: z.string().min(2).max(MAX_MODEL_OUTPUT_CHARS),
    promptMeta: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const TriageEntrySchema = z
  .object({
    jobId: z.string().uuid(),
    matchScore: z.number().int().min(0).max(100),
    reason: z.string().max(200).optional(),
  })
  // Models sometimes add stray keys; only the validated ones are used.
  .loose();

/** Extract the first JSON array from model output (tolerates stray prose). */
function extractJsonArray(text: string): unknown {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  let session: SessionContext;
  try {
    session = await requireSession();
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedError();
    throw err;
  }
  const { userId } = session;

  const rateLimit = checkRateLimit(`jobs:fit:batch:${userId}`, BATCH_RATE_LIMIT);
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

  const raw = extractJsonArray(body.data.modelOutput);
  const entries = z.array(TriageEntrySchema).min(1).max(30).safeParse(raw);
  if (!entries.success) {
    return errorJson(
      "INVALID_AI_RESULT",
      "The triage result did not match the required schema.",
      400,
      {
        details: entries.error.issues
          .slice(0, 5)
          .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`),
      },
    );
  }

  // Only jobs that were part of this batch may be updated; the model cannot
  // steer writes to arbitrary ids.
  const allowed = new Set(body.data.jobIds);
  const seen = new Set<string>();
  const updates = entries.data.filter((entry) => {
    if (!allowed.has(entry.jobId) || seen.has(entry.jobId)) return false;
    seen.add(entry.jobId);
    return true;
  });
  if (updates.length === 0) {
    return errorJson(
      "INVALID_AI_RESULT",
      "The triage result did not reference any job from this batch.",
      400,
    );
  }

  const snapshotHash =
    typeof body.data.promptMeta?.resumeSnapshotUpdatedAt === "string"
      ? body.data.promptMeta.resumeSnapshotUpdatedAt
      : null;
  const now = new Date();
  const writes = await prisma.$transaction(
    updates.map((entry) =>
      prisma.job.updateMany({
        where: {
          id: entry.jobId,
          userId,
          status: "NEW",
          fitScoredAt: null,
          fitSource: fitClaimSource(body.data.claimToken),
        },
        data: {
          fitScore: entry.matchScore,
          // Banding is Joblit's deterministic call, not the model's.
          fitVerdict: verdictForScore(entry.matchScore),
          fitEligibility: null,
          fitSource: "batch",
          fitScoredAt: now,
          fitSnapshotHash: snapshotHash,
        },
      }),
    ),
  );
  const persisted = updates.filter((_, index) => writes[index]?.count === 1);
  if (persisted.length === 0) {
    return errorJson(
      "FIT_CLAIM_EXPIRED",
      "This scoring batch is no longer active. Start or resume the scan.",
      409,
    );
  }

  return NextResponse.json({
    scored: persisted.map((entry) => ({
      jobId: entry.jobId,
      fitScore: entry.matchScore,
      fitVerdict: verdictForScore(entry.matchScore),
    })),
  });
}
