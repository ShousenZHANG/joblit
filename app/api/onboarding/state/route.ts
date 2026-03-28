import { NextResponse } from "next/server";
import { requireSession, UnauthorizedError } from "@/lib/server/auth/requireSession";
import type { SessionContext } from "@/lib/server/auth/requireSession";
import { unauthorizedError } from "@/lib/server/api/errorResponse";
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

const OnboardingTaskIdSchema = z.enum(["resume_setup", "first_fetch", "generate_first_pdf"]);

const ChecklistPatchSchema = z
  .object({
    resume_setup: z.boolean(),
    first_fetch: z.boolean(),
    generate_first_pdf: z.boolean(),
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
  let ctx: SessionContext;
  try {
    ctx = await requireSession();
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedError();
    throw err;
  }
  const { userId } = ctx;

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

    const checklist = normalizeOnboardingChecklist(existing?.checklist);
    const stage = existing?.stage ?? "NEW_USER";
    const state = buildStatePayload({
      stage,
      checklist,
      dismissedAt: existing?.dismissedAt ?? null,
      completedAt: existing?.completedAt ?? null,
      persisted: true,
    });

    if (existing) {
      return NextResponse.json({ tasks: ONBOARDING_TASKS, state });
    }

    const created = await prisma.onboardingState.create({
      data: {
        userId,
        stage: "NEW_USER",
        checklist,
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
        stage: created.stage,
        checklist: normalizeOnboardingChecklist(created.checklist),
        dismissedAt: created.dismissedAt,
        completedAt: created.completedAt,
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
    return NextResponse.json({ error: "ONBOARDING_STATE_FAILED" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  let ctx: SessionContext;
  try {
    ctx = await requireSession();
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedError();
    throw err;
  }
  const { userId } = ctx;

  const json = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "INVALID_BODY", details: parsed.error.flatten() },
      { status: 400 },
    );
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
    return NextResponse.json({ error: "ONBOARDING_STATE_FAILED" }, { status: 500 });
  }
}
