import { z } from "zod";

import {
  buildV2CoverUserPrompt,
  buildV2ResumeUserPrompt,
  buildV2SystemPrompt,
} from "@/lib/server/ai/applicationPromptBuilder";
import {
  buildPromptMeta,
  buildPromptSnapshotHash,
  getExpectedJsonSchemaForTarget,
  getExpectedJsonShapeForTarget,
  type PromptMeta,
} from "@/lib/server/ai/promptContract";
import { computeTop3Coverage } from "@/lib/server/ai/responsibilityCoverage";
import { buildResumePromptSnapshot } from "@/lib/server/ai/resumePromptSnapshot";
import { createRequestId } from "@/lib/server/api/errorResponse";
import { prisma } from "@/lib/server/prisma";
import { getActivePromptSkillRulesForUser } from "@/lib/server/promptRuleTemplates";
import type { PromptSkillRuleSet } from "@/lib/server/ai/promptSkills";
import { getResumeProfile } from "@/lib/server/resumeProfile";
import { marketStringToResumeLocale } from "@/lib/shared/market";

export const ApplicationPromptRequestSchema = z
  .object({
    jobId: z.string().uuid(),
    target: z.enum(["resume", "cover"]),
  })
  .strict();

export interface ApplicationPromptPayload {
  requestId: string;
  prompt: { input: string; instructions: string; sessionId: string };
  promptMeta: PromptMeta;
  expectedJsonShape: string;
  expectedJsonSchema: Record<string, unknown>;
  promptVersion: "v4-application-proposal";
  /**
   * Issuance evidence represented only as hashes so a TailoringRun can bind the
   * exact Master Resume Profile and Job snapshots without persisting either
   * snapshot or the prompt text.
   */
  snapshotBinding?: {
    resumeProfileId: string;
    resumeSnapshotHash: string;
    jobSnapshotHash: string;
  };
}

export type ApplicationPromptErrorCode =
  "INVALID_REQUEST" | "JOB_NOT_FOUND" | "NO_PROFILE" | "PROMPT_TOO_LARGE";

export class ApplicationPromptError extends Error {
  constructor(
    public readonly code: ApplicationPromptErrorCode,
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApplicationPromptError";
  }
}

export const MAX_APPLICATION_PROMPT_CHARS = 64_000;

type ApplicationPromptMessages = {
  errors: {
    applicationPrompt: {
      promptTooLarge: string;
    };
  };
};

async function getPromptTooLargeMessage(
  locale: "en-AU" | "zh-CN",
): Promise<string> {
  const language = locale === "zh-CN" ? "zh" : "en";
  const messages = (await import(`../../../messages/${language}.json`))
    .default as ApplicationPromptMessages;
  return messages.errors.applicationPrompt.promptTooLarge;
}

export async function buildApplicationPromptForUser(input: {
  userId: string;
  jobId: string;
  target: "resume" | "cover";
}): Promise<ApplicationPromptPayload> {
  const parsed = ApplicationPromptRequestSchema.safeParse({
    jobId: input.jobId,
    target: input.target,
  });
  if (!parsed.success) {
    throw new ApplicationPromptError(
      "INVALID_REQUEST",
      "Invalid request body",
      400,
      parsed.error.flatten(),
    );
  }

  const job = await prisma.job.findFirst({
    where: { id: parsed.data.jobId, userId: input.userId },
    select: {
      title: true,
      company: true,
      description: true,
      market: true,
      jobUrl: true,
    },
  });
  if (!job) {
    throw new ApplicationPromptError("JOB_NOT_FOUND", "Job not found", 404);
  }

  const locale = marketStringToResumeLocale(job.market);
  const profile = await getResumeProfile(input.userId, { locale });
  if (!profile) {
    throw new ApplicationPromptError(
      "NO_PROFILE",
      "Create and save your master resume before generating prompt.",
      404,
    );
  }

  const [rules] = await Promise.all([
    getActivePromptSkillRulesForUser(input.userId),
  ]);
  return buildApplicationPromptFromSources({ target: parsed.data.target, profile, job, rules });
}

/** Reconstruct the same prompt from an already owned snapshot. Local-task
 * acceptance uses this with transaction-locked sources, so its final fence
 * cannot drift from the prompt issued by the session endpoint. */
export async function buildApplicationPromptFromSources({ target, profile, job, rules }: {
  target: "resume" | "cover";
  profile: NonNullable<Awaited<ReturnType<typeof getResumeProfile>>>;
  job: { title: string; company: string | null; description: string | null; market: string };
  rules: PromptSkillRuleSet;
}): Promise<ApplicationPromptPayload> {
  const locale = marketStringToResumeLocale(job.market);
  const candidate = buildResumePromptSnapshot(profile);
  const baseLatestBullets = candidate.experiences?.[0]?.bullets ?? [];

  const description = job.description || "";

  const coverage = computeTop3Coverage(description, baseLatestBullets);
  const jobInput = {
    title: job.title,
    company: job.company || "the company",
    description,
  };

  const instructions = buildV2SystemPrompt(rules, locale);
  const promptInput =
    target === "resume"
      ? buildV2ResumeUserPrompt({
          target: "resume",
          rules,
          candidate,
          job: jobInput,
          resume: { coverage },
        })
      : // The job's market decides the cover conventions. A stored rule
        // template records one locale per user, so passing it through would
        // hand a zh-CN posting the en-AU word range.
        buildV2CoverUserPrompt(
          {
            target: "cover",
            rules,
            candidate,
            job: jobInput,
          },
          locale,
        );

  if (instructions.length + promptInput.length > MAX_APPLICATION_PROMPT_CHARS) {
    throw new ApplicationPromptError(
      "PROMPT_TOO_LARGE",
      await getPromptTooLargeMessage(locale),
      413,
    );
  }

  const promptMeta = buildPromptMeta({
    target,
    ruleSetId: rules.id,
    resumeSnapshotUpdatedAt: profile.updatedAt.toISOString(),
    locale,
    variant: "full",
    prompt: { instructions, input: promptInput },
    effectiveRules: rules,
    resumeSnapshot: candidate,
    jobSnapshot: jobInput,
  });

  return {
    requestId: createRequestId(),
    prompt: {
      input: promptInput,
      instructions,
      sessionId: createRequestId(),
    },
    promptMeta,
    expectedJsonShape: JSON.stringify(
      getExpectedJsonShapeForTarget(target),
      null,
      2,
    ),
    expectedJsonSchema: getExpectedJsonSchemaForTarget(target),
    promptVersion: "v4-application-proposal",
    snapshotBinding: {
      resumeProfileId: profile.id,
      resumeSnapshotHash: buildPromptSnapshotHash(candidate),
      jobSnapshotHash: buildPromptSnapshotHash(jobInput),
    },
  };
}
