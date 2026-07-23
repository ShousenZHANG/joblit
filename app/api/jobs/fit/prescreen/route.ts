import { NextResponse } from "next/server";
import { withSessionRoute } from "@/lib/server/api/routeHandler";
import { z } from "zod";

import { errorJson } from "@/lib/server/api/errorResponse";
import { checkRateLimit, rateLimitHeaders } from "@/lib/server/api/rateLimit";
import { prescreenJobFit } from "@/lib/server/ai/fitPrescreen";
import { buildResumePromptSnapshot } from "@/lib/server/ai/resumePromptSnapshot";
import { prisma } from "@/lib/server/prisma";
import { getResumeProfile } from "@/lib/server/resumeProfile";
import { marketStringToResumeLocale } from "@/lib/shared/market";

export const runtime = "nodejs";

const PRESCREEN_RATE_LIMIT = { limit: 10, windowSeconds: 60 } as const;

const BodySchema = z
  .object({
    jobIds: z.array(z.string().uuid()).min(1).max(200),
  })
  .strict();

/**
 * Deterministic batch prescreen: gazetteer skill overlap marks obvious misses
 * POOR without an AI run and returns the ids still worth a local model pass.
 */
export async function POST(req: Request) {
  return withSessionRoute(async ({ userId }) => {
    const rateLimit = checkRateLimit(`jobs:fit:prescreen:${userId}`, PRESCREEN_RATE_LIMIT);
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

    const jobs = await prisma.job.findMany({
      where: { id: { in: body.data.jobIds }, userId },
      select: { id: true, description: true, market: true },
    });
    if (jobs.length === 0) {
      return NextResponse.json({ poor: [], needAi: [] });
    }

    // Resolve one resume snapshot text per locale in the batch.
    const resumeTextByLocale = new Map<string, string | null>();
    async function resumeTextFor(market: string): Promise<string | null> {
      const locale = marketStringToResumeLocale(market);
      if (!resumeTextByLocale.has(locale)) {
        const profile = await getResumeProfile(userId, { locale });
        resumeTextByLocale.set(
          locale,
          profile ? JSON.stringify(buildResumePromptSnapshot(profile)) : null,
        );
      }
      return resumeTextByLocale.get(locale) ?? null;
    }

    const poor: Array<{ jobId: string; score: number; verdict: string }> = [];
    const needAi: string[] = [];
    const now = new Date();

    for (const job of jobs) {
      const resumeText = await resumeTextFor(job.market);
      if (!resumeText) {
        // No resume for this locale: nothing to judge against; skip AI too.
        continue;
      }
      const outcome = prescreenJobFit({
        jobDescription: job.description,
        resumeText,
      });
      if (outcome.decision === "poor") {
        poor.push({ jobId: job.id, score: outcome.result.score, verdict: outcome.result.verdict });
      } else {
        needAi.push(job.id);
      }
    }

    if (poor.length > 0) {
      await prisma.$transaction(
        poor.map((entry) =>
          prisma.job.updateMany({
            where: { id: entry.jobId, userId },
            data: {
              fitScore: entry.score,
              fitVerdict: entry.verdict,
              fitEligibility: null,
              fitMatrix: undefined,
              fitSource: "prescreen",
              fitScoredAt: now,
              fitSnapshotHash: null,
            },
          }),
        ),
      );
    }

    return NextResponse.json({ poor, needAi });
  });
}
