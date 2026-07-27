import { NextResponse } from "next/server";
import { errorJson } from "@/lib/server/api/errorResponse";
import { withSessionRoute } from "@/lib/server/api/routeHandler";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import {
  ONBOARDING_TASKS,
  completedOnboardingTasks,
  defaultOnboardingChecklist,
  isOnboardingComplete,
  mergeOnboardingChecklists,
  normalizeOnboardingChecklist,
  type OnboardingTaskId,
} from "@/lib/onboarding";

export const runtime = "nodejs";

const OnboardingTaskIdSchema = z.enum([
  "resume_setup",
  "first_fetch",
  "review_jobs",
  "generate_first_pdf",
  "mark_applied",
]);

const ChecklistPatchSchema = z
  .object({
    resume_setup: z.boolean(),
    first_fetch: z.boolean(),
    review_jobs: z.boolean(),
    generate_first_pdf: z.boolean(),
    mark_applied: z.boolean(),
  })
  .partial();

const PatchSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("complete_task"),
    taskId: OnboardingTaskIdSchema,
    checklist: ChecklistPatchSchema.optional(),
  }),
  z.object({
    type: z.literal("reopen"),
  }),
  z.object({
    type: z.literal("skip"),
  }),
  z.object({
    type: z.literal("reset"),
  }),
]);

function isMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return code === "P2021" || code === "P2022";
}

/**
 * ADR-0007 keeps the progressed statuses in the database; each of them means
 * the user applied, so they all satisfy `mark_applied`.
 */
const APPLIED_FAMILY = ["APPLIED", "INTERVIEW", "OFFER", "ACCEPTED"] as const;

/**
 * What the database can prove the user has already done.
 *
 * Completion used to be purely client-reported, so a user who built their
 * resume before the guide shipped — or on another device, or whose tab closed
 * before the report landed — was told to do it again. A guide that points at a
 * finished step once is a guide the user learns to ignore.
 *
 * Each task is inferred from the rows its action creates, and only the
 * incomplete ones are queried. `review_jobs` has no row of its own; a job
 * whose status left NEW, or any Application, can only be produced by working
 * the list, so either proves it.
 */
async function inferChecklistFromData(
  userId: string,
  stored: ReturnType<typeof defaultOnboardingChecklist>,
): Promise<ReturnType<typeof defaultOnboardingChecklist>> {
  const needsApplications = !stored.generate_first_pdf || !stored.review_jobs;
  const [profiles, fetchRuns, applications, actionedJobs, appliedJobs] =
    await Promise.all([
      stored.resume_setup ? 0 : prisma.resumeProfile.count({ where: { userId } }),
      stored.first_fetch ? 0 : prisma.fetchRun.count({ where: { userId } }),
      needsApplications ? prisma.application.count({ where: { userId } }) : 0,
      stored.review_jobs
        ? 0
        : prisma.job.count({ where: { userId, status: { not: "NEW" } } }),
      stored.mark_applied
        ? 0
        : prisma.job.count({
            where: { userId, status: { in: [...APPLIED_FAMILY] } },
          }),
    ]);

  return {
    resume_setup: stored.resume_setup || profiles > 0,
    first_fetch: stored.first_fetch || fetchRuns > 0,
    review_jobs: stored.review_jobs || actionedJobs > 0 || applications > 0,
    generate_first_pdf: stored.generate_first_pdf || applications > 0,
    mark_applied: stored.mark_applied || appliedJobs > 0,
  };
}

function deriveStage(
  previousStage: "NEW_USER" | "ACTIVATED_USER" | "RETURNING_USER",
  checklist: ReturnType<typeof defaultOnboardingChecklist>,
  action: "complete_task" | "reopen" | "skip" | "reset",
) {
  if (action === "reset") return "NEW_USER" as const;
  if (isOnboardingComplete(checklist)) return "ACTIVATED_USER" as const;
  if (action === "reopen" && previousStage === "ACTIVATED_USER") return "RETURNING_USER" as const;
  return previousStage === "ACTIVATED_USER" ? "RETURNING_USER" : "NEW_USER";
}

function buildStatePayload(input: {
  stage: "NEW_USER" | "ACTIVATED_USER" | "RETURNING_USER";
  checklist: ReturnType<typeof defaultOnboardingChecklist>;
  dismissedAt: Date | null;
  completedAt: Date | null;
  persisted: boolean;
}) {
  const completedCount = completedOnboardingTasks(input.checklist);
  return {
    stage: input.stage,
    checklist: input.checklist,
    completedCount,
    totalCount: ONBOARDING_TASKS.length,
    isComplete: completedCount >= ONBOARDING_TASKS.length,
    dismissed: Boolean(input.dismissedAt),
    dismissedAt: input.dismissedAt?.toISOString() ?? null,
    completedAt: input.completedAt?.toISOString() ?? null,
    persisted: input.persisted,
  };
}

export async function GET() {
  return withSessionRoute(async ({ userId }) => {
    try {
      const existing = await prisma.onboardingState.findUnique({
        where: { userId },
        select: {
          stage: true,
          checklist: true,
          dismissedAt: true,
          completedAt: true,
        },
      });

      const stored = normalizeOnboardingChecklist(existing?.checklist);
      // Already complete: nothing left to infer, and the activated majority
      // pays zero extra queries.
      const checklist = isOnboardingComplete(stored)
        ? stored
        : await inferChecklistFromData(userId, stored);

      const inferredSomething = ONBOARDING_TASKS.some(
        (task) => checklist[task.id] !== stored[task.id],
      );
      const complete = isOnboardingComplete(checklist);
      const stage = complete
        ? ("ACTIVATED_USER" as const)
        : (existing?.stage ?? ("NEW_USER" as const));
      const completedAt = complete
        ? (existing?.completedAt ?? new Date())
        : (existing?.completedAt ?? null);

      if (existing && !inferredSomething) {
        return NextResponse.json({
          tasks: ONBOARDING_TASKS,
          state: buildStatePayload({
            stage,
            checklist,
            dismissedAt: existing.dismissedAt,
            completedAt,
            persisted: true,
          }),
        });
      }

      // Persist the inferred truth so later GETs read it straight back and the
      // client's own merge never regresses it.
      const written = await prisma.onboardingState.upsert({
        where: { userId },
        create: {
          userId,
          stage,
          checklist,
          completedAt,
        },
        update: {
          stage,
          checklist,
          completedAt,
        },
        select: {
          stage: true,
          checklist: true,
          dismissedAt: true,
          completedAt: true,
        },
      });

      return NextResponse.json({
        tasks: ONBOARDING_TASKS,
        state: buildStatePayload({
          stage: written.stage,
          checklist: normalizeOnboardingChecklist(written.checklist),
          dismissedAt: written.dismissedAt,
          completedAt: written.completedAt,
          persisted: true,
        }),
      });
    } catch (error) {
      if (isMissingTableError(error)) {
        const fallbackChecklist = defaultOnboardingChecklist();
        return NextResponse.json({
          tasks: ONBOARDING_TASKS,
          state: buildStatePayload({
            stage: "NEW_USER",
            checklist: fallbackChecklist,
            dismissedAt: null,
            completedAt: null,
            persisted: false,
          }),
        });
      }
      return errorJson("ONBOARDING_STATE_FAILED", "Onboarding state is unavailable", 500);
    }
  });
}

export async function PATCH(req: Request) {
  return withSessionRoute(async ({ userId }) => {
    const json = await req.json().catch(() => null);
    const parsed = PatchSchema.safeParse(json);
    if (!parsed.success) {
      return errorJson("INVALID_BODY", "Invalid request body", 400, {
        details: parsed.error.flatten(),
      });
    }

    try {
      const existing = await prisma.onboardingState.findUnique({
        where: { userId },
        select: {
          id: true,
          stage: true,
          checklist: true,
          dismissedAt: true,
          completedAt: true,
        },
      });

      const checklist = normalizeOnboardingChecklist(existing?.checklist);
      let nextChecklist = { ...checklist };
      let nextDismissedAt = existing?.dismissedAt ?? null;

      if (parsed.data.type === "complete_task") {
        const taskId = parsed.data.taskId as OnboardingTaskId;
        nextChecklist = mergeOnboardingChecklists(nextChecklist, parsed.data.checklist);
        nextChecklist[taskId] = true;
        nextDismissedAt = null;
      } else if (parsed.data.type === "skip") {
        nextDismissedAt = new Date();
      } else if (parsed.data.type === "reopen") {
        nextDismissedAt = null;
      } else if (parsed.data.type === "reset") {
        nextChecklist = defaultOnboardingChecklist();
        nextDismissedAt = null;
      }

      const previousStage = existing?.stage ?? "NEW_USER";
      const nextStage = deriveStage(previousStage, nextChecklist, parsed.data.type);
      const complete = isOnboardingComplete(nextChecklist);
      const nextCompletedAt = complete ? existing?.completedAt ?? new Date() : null;

      const upserted = await prisma.onboardingState.upsert({
        where: { userId },
        create: {
          userId,
          stage: nextStage,
          checklist: nextChecklist,
          dismissedAt: nextDismissedAt,
          completedAt: nextCompletedAt,
        },
        update: {
          stage: nextStage,
          checklist: nextChecklist,
          dismissedAt: nextDismissedAt,
          completedAt: nextCompletedAt,
        },
        select: {
          stage: true,
          checklist: true,
          dismissedAt: true,
          completedAt: true,
        },
      });

      return NextResponse.json({
        tasks: ONBOARDING_TASKS,
        state: buildStatePayload({
          stage: upserted.stage,
          checklist: normalizeOnboardingChecklist(upserted.checklist),
          dismissedAt: upserted.dismissedAt,
          completedAt: upserted.completedAt,
          persisted: true,
        }),
      });
    } catch (error) {
      if (isMissingTableError(error)) {
        const fallbackChecklist = defaultOnboardingChecklist();
        if (parsed.data.type === "complete_task") {
          const mergedChecklist = mergeOnboardingChecklists(fallbackChecklist, parsed.data.checklist);
          Object.assign(fallbackChecklist, mergedChecklist);
          fallbackChecklist[parsed.data.taskId] = true;
        }
        return NextResponse.json({
          tasks: ONBOARDING_TASKS,
          state: buildStatePayload({
            stage: isOnboardingComplete(fallbackChecklist) ? "ACTIVATED_USER" : "NEW_USER",
            checklist: fallbackChecklist,
            dismissedAt: parsed.data.type === "skip" ? new Date() : null,
            completedAt: isOnboardingComplete(fallbackChecklist) ? new Date() : null,
            persisted: false,
          }),
        });
      }
      return errorJson("ONBOARDING_STATE_FAILED", "Onboarding state is unavailable", 500);
    }
  });
}
