import { Briefcase, FileText, Search, Send, Sparkles } from "lucide-react";
import type { ElementType } from "react";
import {
  ONBOARDING_TASKS,
  type OnboardingChecklist,
  type OnboardingTaskId,
} from "@/lib/onboarding";

/** Per-task icon used across the Quick Start panel and task timeline. */
export const TASK_ICONS: Record<OnboardingTaskId, ElementType> = {
  resume_setup: FileText,
  first_fetch: Search,
  review_jobs: Briefcase,
  generate_first_pdf: Sparkles,
  mark_applied: Send,
};

/** Rough time-to-complete estimate per task (minutes), surfaced as a chip so
 *  the journey feels bounded — a known big-tech onboarding lever ("5 steps,
 *  ~6 min") that reduces drop-off vs an open-ended checklist. */
export const TASK_MINUTES: Record<OnboardingTaskId, number> = {
  resume_setup: 2,
  first_fetch: 1,
  review_jobs: 1,
  generate_first_pdf: 1,
  mark_applied: 1,
};

/** Sum of the estimated minutes for the tasks not yet completed. */
export function minutesLeft(checklist: OnboardingChecklist): number {
  return ONBOARDING_TASKS.reduce(
    (sum, task) => (checklist[task.id] ? sum : sum + TASK_MINUTES[task.id]),
    0,
  );
}
