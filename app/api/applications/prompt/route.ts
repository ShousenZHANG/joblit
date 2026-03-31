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
  buildV2SystemPrompt,
  buildV2ResumeUserPrompt,
  buildV2CoverUserPrompt,
  buildV2ShortUserPrompt,
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

  const promptVersion = new URL(req.url).searchParams.get("promptVersion") ?? "v2";
  const rules = await getActivePromptSkillRulesForUser(userId);
  const mappedProfile = mapResumeProfile(profile);
  const baseLatestBullets = mappedProfile.experiences[0]?.bullets ?? [];
  const coverage = computeTop3Coverage(job.description, baseLatestBullets);

  const jobInput = {
    title: job.title,
    company: job.company || "the company",
    description: job.description || "",
  };
  const resumeInput = { baseLatestBullets, coverage };

  const expectedJsonShape = getExpectedJsonShapeForTarget(parsed.data.target);
  const expectedJsonSchema = getExpectedJsonSchemaForTarget(parsed.data.target);
  const promptMeta = buildPromptMeta({
    target: parsed.data.target,
    ruleSetId: rules.id,
    resumeSnapshotUpdatedAt: profile.updatedAt.toISOString(),
  });

  // V2 prompts: XML-tagged sections with embedded quality gates
  if (promptVersion === "v2") {
    const locale = profileLocale as "en-AU" | "zh-CN";
    const systemPrompt = buildV2SystemPrompt(rules, locale);
    const userPrompt =
      parsed.data.target === "resume"
        ? buildV2ResumeUserPrompt({ target: "resume", rules, job: jobInput, resume: resumeInput })
        : buildV2CoverUserPrompt({ target: "cover", rules, job: jobInput });
    const shortUserPrompt = buildV2ShortUserPrompt({
      target: parsed.data.target,
      job: jobInput,
      resume: parsed.data.target === "resume" ? resumeInput : undefined,
      locale,
    });

    return NextResponse.json({
      requestId,
      prompt: { systemPrompt, userPrompt, shortUserPrompt },
      promptMeta,
      expectedJsonShape,
      expectedJsonSchema,
      promptVersion: "v2",
    });
  }

  // V1 prompts: backward compatible
  const systemPrompt = buildApplicationSystemPrompt(rules);
  const userPrompt = buildApplicationUserPrompt({
    target: parsed.data.target,
    rules,
    job: jobInput,
    resume: resumeInput,
  });
  const shortUserPrompt = buildApplicationShortUserPrompt({
    target: parsed.data.target,
    job: jobInput,
    resume: parsed.data.target === "resume" ? resumeInput : undefined,
  });

  return NextResponse.json({
    requestId,
    prompt: { systemPrompt, userPrompt, shortUserPrompt },
    promptMeta,
    expectedJsonShape,
    expectedJsonSchema,
    promptVersion: "v1",
  });
}
