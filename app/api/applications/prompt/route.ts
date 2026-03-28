import { NextResponse } from "next/server";
import { requireSession, UnauthorizedError } from "@/lib/server/auth/requireSession";
import type { SessionContext } from "@/lib/server/auth/requireSession";
import { unauthorizedError } from "@/lib/server/api/errorResponse";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { getResumeProfile } from "@/lib/server/resumeProfile";
import { getActivePromptSkillRulesForUser } from "@/lib/server/promptRuleTemplates";
import { mapResumeProfile } from "@/lib/server/latex/mapResumeProfile";
import { computeTop3Coverage } from "@/lib/server/ai/responsibilityCoverage";
import {
  buildPromptMeta,
  getExpectedJsonSchemaForTarget,
  getExpectedJsonShapeForTarget,
} from "@/lib/server/ai/promptContract";
import {
  buildApplicationShortUserPrompt,
  buildApplicationSystemPrompt,
  buildApplicationUserPrompt,
} from "@/lib/server/ai/applicationPromptBuilder";

export const runtime = "nodejs";

const PromptSchema = z.object({
  jobId: z.string().uuid(),
  target: z.enum(["resume", "cover"]),
});

export async function POST(req: Request) {
  let ctx: SessionContext;
  try {
    ctx = await requireSession();
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedError();
    throw err;
  }
  const { userId, requestId } = ctx;

  const json = await req.json().catch(() => null);
  const parsed = PromptSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_BODY",
          message: "Invalid request body",
          details: parsed.error.flatten(),
        },
        requestId,
      },
      { status: 400 },
    );
  }

  const job = await prisma.job.findFirst({
    where: {
      id: parsed.data.jobId,
      userId,
    },
    select: {
      title: true,
      company: true,
      description: true,
      market: true,
    },
  });

  if (!job) {
    return NextResponse.json(
      { error: { code: "JOB_NOT_FOUND", message: "Job not found" }, requestId },
      { status: 404 },
    );
  }

  const profileLocale = job.market === "CN" ? "zh-CN" : "en-AU";
  const profile = await getResumeProfile(userId, { locale: profileLocale });
  if (!profile) {
    return NextResponse.json(
      {
        error: {
          code: "NO_PROFILE",
          message: "Create and save your master resume before generating prompt.",
        },
        requestId,
      },
      { status: 404 },
    );
  }

  const rules = await getActivePromptSkillRulesForUser(userId);
  const mappedProfile = mapResumeProfile(profile);
  const baseLatestBullets = mappedProfile.experiences[0]?.bullets ?? [];
  const coverage = computeTop3Coverage(job.description, baseLatestBullets);
  const systemPrompt = buildApplicationSystemPrompt(rules);
  const userPrompt = buildApplicationUserPrompt({
    target: parsed.data.target,
    rules,
    job: {
      title: job.title,
      company: job.company || "the company",
      description: job.description || "",
    },
    resume: {
      baseLatestBullets,
      coverage,
    },
  });

  const expectedJsonShape = getExpectedJsonShapeForTarget(parsed.data.target);
  const expectedJsonSchema = getExpectedJsonSchemaForTarget(parsed.data.target);
  const promptMeta = buildPromptMeta({
    target: parsed.data.target,
    ruleSetId: rules.id,
    resumeSnapshotUpdatedAt: profile.updatedAt.toISOString(),
  });

  const shortUserPrompt = buildApplicationShortUserPrompt({
    target: parsed.data.target,
    job: {
      title: job.title,
      company: job.company || "the company",
      description: job.description || "",
    },
    resume:
      parsed.data.target === "resume"
        ? { baseLatestBullets, coverage }
        : undefined,
  });

  return NextResponse.json({
    requestId,
    prompt: {
      systemPrompt,
      userPrompt,
      shortUserPrompt,
    },
    promptMeta,
    expectedJsonShape,
    expectedJsonSchema,
  });
}
