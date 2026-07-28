import {
  ONBOARDING_TASKS,
  completedOnboardingTasks,
  mergeOnboardingChecklists,
  type OnboardingChecklist,
  type OnboardingTask,
  type OnboardingTaskId,
} from "@/lib/onboarding";

export type GuideJourneyState = {
  stage: "NEW_USER" | "ACTIVATED_USER" | "RETURNING_USER";
  checklist: OnboardingChecklist;
  completedCount: number;
  totalCount: number;
  isComplete: boolean;
  dismissed: boolean;
  dismissedAt: string | null;
  completedAt: string | null;
  persisted: boolean;
};

type GuideCelebration = {
  completedTaskId: OnboardingTaskId;
  nextTask: OnboardingTask | null;
};

export type GuideTaskCompletion =
  | {
      changed: false;
      state: GuideJourneyState | null;
      checklist: null;
      celebration: null;
    }
  | {
      changed: true;
      state: GuideJourneyState;
      checklist: OnboardingChecklist;
      celebration: GuideCelebration | null;
    };

export function reconcileGuideState(
  previousState: GuideJourneyState | null,
  nextState: GuideJourneyState,
  preserveCompleted: boolean,
): GuideJourneyState {
  if (!previousState || !preserveCompleted) {
    return nextState;
  }

  const checklist = mergeOnboardingChecklists(previousState.checklist, nextState.checklist);
  const completedCount = completedOnboardingTasks(checklist);
  return {
    ...nextState,
    checklist,
    completedCount,
    isComplete: completedCount >= nextState.totalCount,
  };
}

export function currentGuideTask(state: GuideJourneyState | null): OnboardingTask | null {
  if (!state || state.isComplete || state.dismissed) return null;
  return ONBOARDING_TASKS.find((task) => !state.checklist[task.id]) ?? null;
}

/**
 * Completes one visible Guide journey step as a single in-process transition.
 *
 * The caller receives every decision produced from the same state snapshot:
 * the next UI state, the checklist sent to persistence, and whether the user
 * should see a celebration with a next step.
 */
export function completeGuideTask(
  current: GuideJourneyState | null,
  taskId: OnboardingTaskId,
): GuideTaskCompletion {
  if (!current || current.checklist[taskId]) {
    return {
      changed: false,
      state: current,
      checklist: null,
      celebration: null,
    };
  }

  const checklist: OnboardingChecklist = {
    ...current.checklist,
    [taskId]: true,
  };
  const completedCount = completedOnboardingTasks(checklist);
  const state: GuideJourneyState = {
    ...current,
    checklist,
    completedCount,
    isComplete: completedCount >= current.totalCount,
  };

  return {
    changed: true,
    state,
    checklist,
    celebration: current.dismissed
      ? null
      : {
          completedTaskId: taskId,
          nextTask: currentGuideTask(state),
        },
  };
}
