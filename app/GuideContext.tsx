"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import {
  ArrowRight,
  Briefcase,
  Check,
  CircleHelp,
  FileText,
  PartyPopper,
  Search,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ONBOARDING_TASKS,
  mergeOnboardingChecklists,
  type OnboardingChecklist,
  type OnboardingTask,
  type OnboardingTaskId,
} from "@/lib/onboarding";

type GuideState = {
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

type GuideContextValue = {
  loading: boolean;
  state: GuideState | null;
  activeTaskId: OnboardingTaskId | null;
  /**
   * @deprecated Retained for backwards compatibility with components that
   * still consume tour APIs. The new design uses a single panel and never
   * runs a step-by-step tour.
   */
  tourRunning: boolean;
  tourTaskId: OnboardingTaskId | null;
  tourStep: number;
  openGuide: () => void;
  closeGuide: () => void;
  startTour: () => void;
  stopTour: () => void;
  nextStep: () => void;
  prevStep: () => void;
  markTaskComplete: (taskId: OnboardingTaskId) => void;
  isTaskHighlighted: (taskId: OnboardingTaskId) => boolean;
};

const WELCOME_SHOWN_KEY = "joblit_guide_welcome_shown";

const TASK_ICONS: Record<OnboardingTaskId, React.ElementType> = {
  resume_setup: FileText,
  first_fetch: Search,
  review_jobs: Briefcase,
  generate_first_pdf: Sparkles,
  mark_applied: Send,
};

const GuideContext = createContext<GuideContextValue | null>(null);

function getTaskById(taskId: OnboardingTaskId | null): OnboardingTask | null {
  if (!taskId) return null;
  return ONBOARDING_TASKS.find((task) => task.id === taskId) ?? null;
}

function resolveGuideState(
  previousState: GuideState | null,
  nextState: GuideState,
  preserveCompleted: boolean,
): GuideState {
  if (!previousState || !preserveCompleted) {
    return nextState;
  }
  const checklist = mergeOnboardingChecklists(previousState.checklist, nextState.checklist);
  const completedCount = ONBOARDING_TASKS.reduce(
    (count, task) => (checklist[task.id] ? count + 1 : count),
    0,
  );
  return {
    ...nextState,
    checklist,
    completedCount,
    isComplete: completedCount >= nextState.totalCount,
  };
}

export function GuideProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { data: session } = useSession();
  const userId = session?.user?.id ?? null;
  const tg = useTranslations("guide");

  const [loading, setLoading] = useState(false);
  const [state, setState] = useState<GuideState | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  const fetchState = useCallback(async () => {
    if (!userId) {
      setState(null);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/onboarding/state", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to load onboarding state");
      const nextState = json.state as GuideState;
      setState((prev) => {
        const resolved = resolveGuideState(prev, nextState, true);
        // Auto-open the panel for brand-new users on their very first visit
        // of the session — but only once per session so it doesn't pop on
        // every navigation.
        const isNewUser =
          resolved.stage === "NEW_USER" &&
          !resolved.dismissed &&
          !resolved.completedAt &&
          !resolved.isComplete;
        const alreadyShown = sessionStorage.getItem(WELCOME_SHOWN_KEY) === "1";
        if (isNewUser && !alreadyShown) {
          setPanelOpen(true);
          sessionStorage.setItem(WELCOME_SHOWN_KEY, "1");
        }
        return resolved;
      });
    } catch {
      setState(null);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void fetchState();
  }, [fetchState]);

  const patchState = useCallback(
    async (
      payload:
        | { type: "complete_task"; taskId: OnboardingTaskId; checklist?: OnboardingChecklist }
        | { type: "reopen" }
        | { type: "skip" }
        | { type: "reset" },
    ) => {
      if (!userId) return;
      try {
        const res = await fetch("/api/onboarding/state", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || "Failed to update onboarding state");
        const nextState = json.state as GuideState;
        setState((prev) => resolveGuideState(prev, nextState, payload.type !== "reset"));
      } catch {
        // Keep UI resilient even if persistence is temporarily unavailable.
      }
    },
    [userId],
  );

  const activeTaskId = useMemo<OnboardingTaskId | null>(() => {
    if (!state || state.isComplete || state.dismissed) return null;
    const nextTask = ONBOARDING_TASKS.find((task) => !state.checklist[task.id]);
    return nextTask?.id ?? null;
  }, [state]);

  const markTaskComplete = useCallback(
    (taskId: OnboardingTaskId) => {
      let checklistForPatch: OnboardingChecklist | null = null;
      setState((prev) => {
        if (!prev || prev.checklist[taskId]) return prev;
        const checklist = { ...prev.checklist, [taskId]: true };
        checklistForPatch = checklist;
        const completedCount = ONBOARDING_TASKS.reduce(
          (count, task) => (checklist[task.id] ? count + 1 : count),
          0,
        );
        return {
          ...prev,
          checklist,
          completedCount,
          isComplete: completedCount >= prev.totalCount,
        };
      });
      void patchState(
        checklistForPatch
          ? { type: "complete_task", taskId, checklist: checklistForPatch }
          : { type: "complete_task", taskId },
      );
    },
    [patchState],
  );

  const openGuide = useCallback(() => {
    setPanelOpen(true);
    void patchState({ type: "reopen" });
  }, [patchState]);

  const closeGuide = useCallback(() => {
    setPanelOpen(false);
  }, []);

  const dismissGuide = useCallback(() => {
    setPanelOpen(false);
    void patchState({ type: "skip" });
  }, [patchState]);

  const navigateToTask = useCallback(
    (task: OnboardingTask) => {
      router.push(task.href);
      setPanelOpen(false);
    },
    [router],
  );

  // Global "?" shortcut — open / close panel from anywhere when the user
  // is not typing in an input. Mirrors the Linear / Vercel / GitHub
  // convention.
  useEffect(() => {
    if (!userId) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;

      if (event.key === "Escape" && panelOpen) {
        event.preventDefault();
        setPanelOpen(false);
        return;
      }

      if (event.key !== "?" && !(event.shiftKey && event.key === "/")) return;

      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const interactiveTag =
        tag === "input" || tag === "textarea" || tag === "select";
      if (target?.isContentEditable || interactiveTag) return;

      event.preventDefault();
      setPanelOpen((prev) => !prev);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [panelOpen, userId]);

  const value = useMemo<GuideContextValue>(
    () => ({
      loading,
      state,
      activeTaskId,
      tourRunning: panelOpen,
      tourTaskId: activeTaskId,
      tourStep: state ? state.completedCount + 1 : 0,
      openGuide,
      closeGuide,
      startTour: openGuide,
      stopTour: closeGuide,
      nextStep: () => {
        // No-op — the new design has no sequential step navigation.
      },
      prevStep: () => {
        // No-op — the new design has no sequential step navigation.
      },
      markTaskComplete,
      // The new design no longer highlights anchors via spotlight; consumers
      // that called isTaskHighlighted (e.g. ResumeActionBar guide ring)
      // continue to compile but receive `false` so no ring is drawn.
      isTaskHighlighted: () => false,
    }),
    [activeTaskId, closeGuide, loading, markTaskComplete, openGuide, panelOpen, state],
  );

  return (
    <GuideContext.Provider value={value}>
      {children}
      {userId && state ? (
        <>
          {/* Floating launcher — visible whenever the panel is closed and
              progress is incomplete. Click reopens the Quick Start panel. */}
          {!panelOpen && !state.isComplete ? (
            <button
              type="button"
              onClick={openGuide}
              data-testid="guide-floating-widget"
              aria-label={tg("panelTitle")}
              className="group fixed bottom-5 right-5 z-[52] inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-2 text-card-foreground shadow-[0_12px_30px_-15px_rgba(15,23,42,0.45)] transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[0_20px_40px_-20px_rgba(5,150,105,0.45)] active:scale-[0.97] motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100 motion-reduce:transition-none"
              style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
            >
              <span className="relative flex h-7 w-7 items-center justify-center">
                <svg className="absolute h-7 w-7 -rotate-90" viewBox="0 0 28 28" aria-hidden>
                  <circle cx="14" cy="14" r="11" fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth="2.5" />
                  <circle
                    cx="14"
                    cy="14"
                    r="11"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeDasharray={`${(state.completedCount / state.totalCount) * 69.115} 69.115`}
                    className="text-emerald-500 transition-[stroke-dasharray] duration-500 ease-out"
                  />
                </svg>
                <CircleHelp className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />
              </span>
              <span className="flex items-center gap-1.5 text-xs font-semibold">
                <span className="hidden sm:inline">{tg("panelTitle")}</span>
                <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                  {state.completedCount}/{state.totalCount}
                </span>
                <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </span>
            </button>
          ) : null}

          {/* Quick Start panel — slide-up sheet anchored bottom-right.
              On mobile it expands to a full-width bottom sheet. */}
          {panelOpen ? (
            <>
              <div
                className="fixed inset-0 z-[60] bg-foreground/40 backdrop-blur-sm md:hidden guide-fade-in"
                onClick={closeGuide}
                aria-hidden
              />
              <section
                role="dialog"
                aria-modal="true"
                aria-labelledby="guide-panel-title"
                data-testid="guide-quickstart-panel"
                className="fixed inset-x-0 bottom-0 z-[61] flex max-h-[85dvh] flex-col rounded-t-2xl border border-border bg-card text-card-foreground shadow-[0_24px_60px_-30px_rgba(15,23,42,0.45)] guide-scale-in md:bottom-5 md:left-auto md:right-5 md:top-auto md:max-h-[min(640px,calc(100dvh-2.5rem))] md:w-[380px] md:rounded-2xl"
                style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
              >
                {/* Header */}
                <header className="flex items-start justify-between gap-3 border-b border-border/60 px-5 pb-4 pt-4">
                  <div className="min-w-0 flex-1">
                    <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                      <Sparkles className="h-3 w-3" aria-hidden />
                      {tg("badge")}
                    </div>
                    <h2 id="guide-panel-title" className="mt-1.5 text-base font-bold text-foreground">
                      {state.isComplete ? tg("allDone") : tg("panelTitle")}
                    </h2>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                      {state.isComplete ? tg("allDoneDesc") : tg("panelSubtitle")}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={closeGuide}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    aria-label="Close"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </header>

                {/* Progress bar */}
                <div className="px-5 pt-3">
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>
                      {state.completedCount} / {state.totalCount}
                    </span>
                    <span className="font-semibold text-foreground">
                      {Math.round((state.completedCount / state.totalCount) * 100)}%
                    </span>
                  </div>
                  <div
                    className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-valuenow={state.completedCount}
                    aria-valuemin={0}
                    aria-valuemax={state.totalCount}
                  >
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-[width] duration-500 ease-out"
                      style={{
                        width: `${(state.completedCount / state.totalCount) * 100}%`,
                      }}
                    />
                  </div>
                </div>

                {/* Task list */}
                <ol
                  className="flex-1 overflow-y-auto px-5 py-4"
                  data-testid="guide-quickstart-list"
                >
                  {state.isComplete ? (
                    <li className="flex flex-col items-center justify-center gap-3 py-8 text-center">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300">
                        <PartyPopper className="h-6 w-6" aria-hidden />
                      </div>
                      <p className="text-sm font-semibold text-foreground">{tg("allDone")}</p>
                      <Button type="button" size="sm" onClick={dismissGuide} className="rounded-xl">
                        {tg("dismissPanel")}
                      </Button>
                    </li>
                  ) : (
                    ONBOARDING_TASKS.map((task) => {
                      const Icon = TASK_ICONS[task.id];
                      const done = state.checklist[task.id];
                      const current = !done && task.id === activeTaskId;
                      return (
                        <li
                          key={task.id}
                          data-task-id={task.id}
                          data-task-state={done ? "done" : current ? "current" : "todo"}
                          className={`group/task -mx-2 mb-1 rounded-xl px-3 py-3 transition-colors ${
                            current ? "bg-emerald-50/60 dark:bg-emerald-500/10" : "hover:bg-muted/60"
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            {/* Status indicator */}
                            <div
                              className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                                done
                                  ? "border-emerald-500 bg-emerald-500 text-white"
                                  : current
                                    ? "border-emerald-500 bg-background text-emerald-600 dark:text-emerald-300"
                                    : "border-border bg-background text-muted-foreground"
                              }`}
                              aria-hidden
                            >
                              {done ? (
                                <Check className="h-3 w-3" />
                              ) : (
                                <Icon className="h-3 w-3" />
                              )}
                            </div>

                            {/* Body */}
                            <div className="min-w-0 flex-1">
                              <p
                                className={`text-sm font-semibold ${
                                  done ? "text-muted-foreground line-through" : "text-foreground"
                                }`}
                              >
                                {tg(`task_${task.id}_title`)}
                              </p>
                              {!done ? (
                                <>
                                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                                    {tg(`task_${task.id}_how`)}
                                  </p>
                                  {current ? (
                                    <Button
                                      type="button"
                                      size="sm"
                                      onClick={() => navigateToTask(task)}
                                      className="mt-2 h-8 rounded-lg text-xs"
                                    >
                                      {tg("takeMeThere")}
                                      <ArrowRight className="ml-1 h-3 w-3" aria-hidden />
                                    </Button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => navigateToTask(task)}
                                      className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-emerald-700 transition-colors hover:text-emerald-600 dark:text-emerald-400 dark:hover:text-emerald-300"
                                    >
                                      {tg("takeMeThere")}
                                      <ArrowRight className="h-3 w-3" aria-hidden />
                                    </button>
                                  )}
                                </>
                              ) : (
                                <span className="mt-0.5 inline-block text-[11px] font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                                  {tg("completed")}
                                </span>
                              )}
                            </div>
                          </div>
                        </li>
                      );
                    })
                  )}
                </ol>

                {/* Footer hint */}
                {!state.isComplete ? (
                  <footer className="border-t border-border/60 px-5 py-3 text-[11px] text-muted-foreground">
                    {tg("openPanelHint", { kbd: "?" }).split("?").map((part, i, arr) => (
                      <span key={i}>
                        {part}
                        {i < arr.length - 1 ? (
                          <kbd className="mx-0.5 inline-flex h-5 min-w-[20px] items-center justify-center rounded border border-border bg-muted px-1 font-mono font-medium text-foreground/80">
                            ?
                          </kbd>
                        ) : null}
                      </span>
                    ))}
                  </footer>
                ) : null}
              </section>
            </>
          ) : null}
        </>
      ) : null}
    </GuideContext.Provider>
  );
}

export function useGuide() {
  const context = useContext(GuideContext);
  if (context) return context;
  return {
    loading: false,
    state: null,
    activeTaskId: null,
    tourRunning: false,
    tourTaskId: null,
    tourStep: 0,
    openGuide: () => {},
    closeGuide: () => {},
    startTour: () => {},
    stopTour: () => {},
    nextStep: () => {},
    prevStep: () => {},
    markTaskComplete: () => {},
    isTaskHighlighted: () => false,
  };
}

// Internal helper retained for type compatibility with existing consumers.
export type { OnboardingTask };
