export type OnboardingTaskId =
  | "resume_setup"
  | "first_fetch"
  | "review_jobs"
  | "generate_first_pdf"
  | "mark_applied"
  | "install_extension";

export type OnboardingTask = {
  id: OnboardingTaskId;
  href: "/resume" | "/fetch" | "/jobs" | "/extension";
};

export const ONBOARDING_TASKS: OnboardingTask[] = [
  {
    id: "resume_setup",
    href: "/resume",
  },
  {
    id: "first_fetch",
    href: "/fetch",
  },
  {
    id: "review_jobs",
    href: "/jobs",
  },
  {
    id: "generate_first_pdf",
    href: "/jobs",
  },
  {
    id: "mark_applied",
    href: "/jobs",
  },
  {
    id: "install_extension",
    href: "/extension",
  },
];

export type OnboardingChecklist = Record<OnboardingTaskId, boolean>;

export function defaultOnboardingChecklist(): OnboardingChecklist {
  return {
    resume_setup: false,
    first_fetch: false,
    review_jobs: false,
    generate_first_pdf: false,
    mark_applied: false,
    install_extension: false,
  };
}

export function normalizeOnboardingChecklist(value: unknown): OnboardingChecklist {
  const fallback = defaultOnboardingChecklist();
  if (!value || typeof value !== "object") return fallback;

  const record = value as Record<string, unknown>;
  return {
    resume_setup:
      typeof record.resume_setup === "boolean" ? record.resume_setup : fallback.resume_setup,
    first_fetch: typeof record.first_fetch === "boolean" ? record.first_fetch : fallback.first_fetch,
    review_jobs:
      typeof record.review_jobs === "boolean" ? record.review_jobs : fallback.review_jobs,
    generate_first_pdf:
      typeof record.generate_first_pdf === "boolean"
        ? record.generate_first_pdf
        : fallback.generate_first_pdf,
    mark_applied:
      typeof record.mark_applied === "boolean" ? record.mark_applied : fallback.mark_applied,
    install_extension:
      typeof record.install_extension === "boolean"
        ? record.install_extension
        : fallback.install_extension,
  };
}

export function mergeOnboardingChecklists(
  base: OnboardingChecklist,
  incoming: Partial<OnboardingChecklist> | null | undefined,
): OnboardingChecklist {
  const normalizedIncoming = normalizeOnboardingChecklist(incoming ?? {});
  return {
    resume_setup: base.resume_setup || normalizedIncoming.resume_setup,
    first_fetch: base.first_fetch || normalizedIncoming.first_fetch,
    review_jobs: base.review_jobs || normalizedIncoming.review_jobs,
    generate_first_pdf: base.generate_first_pdf || normalizedIncoming.generate_first_pdf,
    mark_applied: base.mark_applied || normalizedIncoming.mark_applied,
    install_extension: base.install_extension || normalizedIncoming.install_extension,
  };
}

export function completedOnboardingTasks(checklist: OnboardingChecklist): number {
  return ONBOARDING_TASKS.reduce(
    (count, task) => (checklist[task.id] ? count + 1 : count),
    0,
  );
}

export function isOnboardingComplete(checklist: OnboardingChecklist): boolean {
  return completedOnboardingTasks(checklist) >= ONBOARDING_TASKS.length;
}
