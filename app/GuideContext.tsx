"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
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

type CoachmarkRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

const COACHMARK_DISMISS_KEY = "joblit_guide_coachmark_dismissed";

function readDismissedCoachmarks(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.sessionStorage.getItem(COACHMARK_DISMISS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((s) => typeof s === "string")) : new Set();
  } catch {
    return new Set();
  }
}

function writeDismissedCoachmarks(set: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(COACHMARK_DISMISS_KEY, JSON.stringify(Array.from(set)));
  } catch {
    // sessionStorage may be disabled (privacy mode); fall through.
  }
}

function requestGuideFrame(callback: FrameRequestCallback): number {
  if (typeof window !== "undefined" && window.requestAnimationFrame) {
    return window.requestAnimationFrame(callback);
  }
  return window.setTimeout(() => callback(performance.now()), 16);
}

function cancelGuideFrame(frame: number) {
  if (typeof window !== "undefined" && window.cancelAnimationFrame) {
    window.cancelAnimationFrame(frame);
    return;
  }
  window.clearTimeout(frame);
}

/** Safe guarded read for the once-per-session welcome flag. */
function welcomeAlreadyShown(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.sessionStorage.getItem(WELCOME_SHOWN_KEY) === "1";
  } catch {
    return true;
  }
}

function markWelcomeShown() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(WELCOME_SHOWN_KEY, "1");
  } catch {
    // sessionStorage may be disabled; fall through.
  }
}

export function GuideProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: session } = useSession();
  const userId = session?.user?.id ?? null;
  const tg = useTranslations("guide");

  const [loading, setLoading] = useState(false);
  const [state, setState] = useState<GuideState | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [coachmarkTaskId, setCoachmarkTaskId] = useState<OnboardingTaskId | null>(null);
  const [coachmarkRect, setCoachmarkRect] = useState<CoachmarkRect | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const dismissedCoachmarksRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    dismissedCoachmarksRef.current = readDismissedCoachmarks();
  }, []);

  // Focus management — when the panel or coachmark opens, move focus into
  // the new dialog so screen-reader users can immediately interact. WCAG
  // 2.1 SC 4.1.3 / ARIA Authoring Practices.
  const panelRef = useRef<HTMLElement | null>(null);
  const coachmarkRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!panelOpen) return;
    const node = panelRef.current;
    if (!node) return;
    const focusable = node.querySelector<HTMLElement>(
      "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
    );
    focusable?.focus();
  }, [panelOpen]);

  useEffect(() => {
    if (!coachmarkTaskId) return;
    const node = coachmarkRef.current;
    if (!node) return;
    const focusable = node.querySelector<HTMLElement>(
      "button, [href], [tabindex]:not([tabindex='-1'])",
    );
    focusable?.focus({ preventScroll: true });
  }, [coachmarkTaskId, coachmarkRect]);

  useEffect(() => {
    let frame = 0;
    const sync = () => {
      if (frame) cancelGuideFrame(frame);
      frame = requestGuideFrame(() => {
        frame = 0;
        setViewport({ width: window.innerWidth, height: window.innerHeight });
      });
    };
    sync();
    window.addEventListener("resize", sync, { passive: true });
    return () => {
      if (frame) cancelGuideFrame(frame);
      window.removeEventListener("resize", sync);
    };
  }, []);

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
        if (isNewUser && !welcomeAlreadyShown()) {
          setPanelOpen(true);
          markWelcomeShown();
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
      // Auto-dismiss the coachmark when its task completes — user has
      // visibly succeeded so the guidance has done its job. Use a
      // functional setter so the closure can never read a stale
      // coachmarkTaskId value.
      setCoachmarkTaskId((prev) => {
        if (prev === taskId) {
          setCoachmarkRect(null);
          return null;
        }
        return prev;
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
      // Allow this task's coachmark to re-appear even if it was dismissed
      // earlier in the session — the user explicitly asked to be guided.
      const next = new Set(dismissedCoachmarksRef.current);
      next.delete(task.id);
      dismissedCoachmarksRef.current = next;
      writeDismissedCoachmarks(next);

      setCoachmarkTaskId(task.id);
      setCoachmarkRect(null);
      router.push(task.href);
      setPanelOpen(false);
    },
    [router],
  );

  const dismissCoachmark = useCallback(() => {
    if (!coachmarkTaskId) return;
    const next = new Set(dismissedCoachmarksRef.current);
    next.add(coachmarkTaskId);
    dismissedCoachmarksRef.current = next;
    writeDismissedCoachmarks(next);
    setCoachmarkTaskId(null);
    setCoachmarkRect(null);
  }, [coachmarkTaskId]);

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

  // Stable callback so consumers passing isTaskHighlighted into
  // React.memo'd children don't blow their memo cache on every render.
  const isTaskHighlighted = useCallback(
    (taskId: OnboardingTaskId) => {
      if (!coachmarkTaskId || coachmarkTaskId !== taskId) return false;
      const task = ONBOARDING_TASKS.find((t) => t.id === taskId);
      if (!task) return false;
      return pathname === task.href || pathname.startsWith(`${task.href}/`);
    },
    [coachmarkTaskId, pathname],
  );

  const noopStep = useCallback(() => {
    // No-op — the new design has no sequential step navigation.
  }, []);

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
      nextStep: noopStep,
      prevStep: noopStep,
      markTaskComplete,
      // Drives the existing emerald ring on ResumeActionBar /
      // FetchClient run buttons / JobDetailPanel generate when the
      // matching coachmark is active.
      isTaskHighlighted,
    }),
    [activeTaskId, closeGuide, isTaskHighlighted, loading, markTaskComplete, noopStep, openGuide, panelOpen, state],
  );

  // Clear the coachmark if the user navigates to a page that isn't the
  // task's home page — they've moved on, so the inline guide should too.
  useEffect(() => {
    if (!coachmarkTaskId) return;
    const task = ONBOARDING_TASKS.find((t) => t.id === coachmarkTaskId);
    if (!task) return;
    const onTaskPage = pathname === task.href || pathname.startsWith(`${task.href}/`);
    if (!onTaskPage) {
      setCoachmarkTaskId(null);
      setCoachmarkRect(null);
    }
  }, [coachmarkTaskId, pathname]);

  // Locate the coachmark target from observable browser events. This avoids
  // a permanent polling interval while still following scroll, resize, and
  // page-level DOM changes triggered by route transitions.
  useEffect(() => {
    if (!coachmarkTaskId) {
      setCoachmarkRect(null);
      return;
    }
    const task = ONBOARDING_TASKS.find((t) => t.id === coachmarkTaskId);
    if (!task) return;
    const onTaskPage = pathname === task.href || pathname.startsWith(`${task.href}/`);
    if (!onTaskPage) return;

    // Cap polling at 30 iterations (≈6 s) so a missing or never-rendering
    // anchor cannot keep scheduling work forever.
    let attempts = 0;
    let timeoutCleared = false;
    let frame = 0;
    let retryTimer = 0;
    let observedTarget: HTMLElement | null = null;
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            scheduleLocate();
          });
    const mutationObserver =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(() => {
            scheduleLocate();
          });

    const observeTarget = (target: HTMLElement) => {
      if (!resizeObserver || observedTarget === target) return;
      resizeObserver.disconnect();
      resizeObserver.observe(target);
      observedTarget = target;
    };

    const locate = () => {
      const target = document.querySelector<HTMLElement>(`[data-guide-anchor="${coachmarkTaskId}"]`);
      if (target) {
        observeTarget(target);
        const rect = target.getBoundingClientRect();
        if (rect.width >= 1 && rect.height >= 1) {
          setCoachmarkRect((prev) => {
            const next = { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
            if (
              prev &&
              Math.abs(prev.top - next.top) < 1 &&
              Math.abs(prev.left - next.left) < 1 &&
              Math.abs(prev.width - next.width) < 1 &&
              Math.abs(prev.height - next.height) < 1
            ) {
              return prev;
            }
            return next;
          });
          return;
        }
      }
      // Anchor not visible yet. Increment the attempt counter only when
      // we still haven't located it; once located the early return above
      // skips this branch and the loop simply tracks the existing rect.
      setCoachmarkRect(null);
      attempts++;
      if (attempts >= 30 && !timeoutCleared) {
        timeoutCleared = true;
        window.clearTimeout(retryTimer);
        setCoachmarkTaskId(null);
        return;
      }
      retryTimer = window.setTimeout(scheduleLocate, 200);
    };

    function scheduleLocate() {
      if (timeoutCleared || frame) return;
      frame = requestGuideFrame(() => {
        frame = 0;
        locate();
      });
    }

    scheduleLocate();
    mutationObserver?.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "data-guide-anchor"],
    });
    window.addEventListener("scroll", scheduleLocate, { capture: true, passive: true });
    window.addEventListener("resize", scheduleLocate, { passive: true });
    return () => {
      timeoutCleared = true;
      if (frame) cancelGuideFrame(frame);
      window.clearTimeout(retryTimer);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      window.removeEventListener("scroll", scheduleLocate, true);
      window.removeEventListener("resize", scheduleLocate);
    };
  }, [coachmarkTaskId, pathname]);

  // Position math for the floating coachmark — placed below the target
  // when there's room, otherwise above. Keeps a 12px viewport edge gap.
  const coachmarkLayout = useMemo(() => {
    if (!coachmarkRect || viewport.width <= 0 || viewport.height <= 0) return null;
    const cardWidth = Math.min(320, viewport.width - 24);
    const cardHeight = 180;
    const left = Math.max(
      12,
      Math.min(
        coachmarkRect.left + coachmarkRect.width / 2 - cardWidth / 2,
        viewport.width - cardWidth - 12,
      ),
    );
    const placeBelow = coachmarkRect.top + coachmarkRect.height + cardHeight + 24 < viewport.height;
    const top = placeBelow
      ? coachmarkRect.top + coachmarkRect.height + 14
      : Math.max(12, coachmarkRect.top - cardHeight - 14);
    const arrowLeft = Math.max(
      18,
      Math.min(
        coachmarkRect.left + coachmarkRect.width / 2 - left - 6,
        cardWidth - 30,
      ),
    );
    return { top, left, width: cardWidth, arrowLeft, placement: placeBelow ? ("below" as const) : ("above" as const) };
  }, [coachmarkRect, viewport.height, viewport.width]);

  const activeCoachmarkTask = useMemo(() => {
    if (!coachmarkTaskId) return null;
    return ONBOARDING_TASKS.find((t) => t.id === coachmarkTaskId) ?? null;
  }, [coachmarkTaskId]);

  const coachmarkStepNumber = useMemo(() => {
    if (!coachmarkTaskId) return 0;
    const idx = ONBOARDING_TASKS.findIndex((t) => t.id === coachmarkTaskId);
    return idx >= 0 ? idx + 1 : 0;
  }, [coachmarkTaskId]);

  return (
    <GuideContext.Provider value={value}>
      {children}
      {userId && state ? (
        <>
          {/* Inline coachmark — non-blocking tooltip that anchors to the
              relevant element on the active task page. Lets the user keep
              interacting with the page (no dark overlay) while still seeing
              a clear "do this" instruction next to the actual control. */}
          {coachmarkTaskId && activeCoachmarkTask && coachmarkLayout && !panelOpen ? (
            <section
              ref={(node) => {
                coachmarkRef.current = node;
              }}
              data-testid="guide-coachmark"
              role="dialog"
              aria-modal="false"
              aria-labelledby="guide-coachmark-title"
              className="pointer-events-auto fixed z-[58] rounded-2xl border border-border bg-card text-card-foreground shadow-[0_24px_60px_-30px_rgba(15,23,42,0.5)] guide-tour-enter motion-reduce:animate-none"
              style={{
                top: coachmarkLayout.top,
                left: coachmarkLayout.left,
                width: coachmarkLayout.width,
              }}
            >
              {/* Pointer arrow */}
              <span
                aria-hidden
                className={[
                  "absolute h-3 w-3 rotate-45 border bg-card",
                  coachmarkLayout.placement === "below"
                    ? "-top-1.5 border-b-transparent border-r-transparent border-border"
                    : "-bottom-1.5 border-t-transparent border-l-transparent border-border",
                ].join(" ")}
                style={{ left: coachmarkLayout.arrowLeft }}
              />

              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                    <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-500 text-[9px] font-extrabold text-primary-foreground">
                      {coachmarkStepNumber}
                    </span>
                    {tg("stepOf", { current: coachmarkStepNumber, total: state.totalCount })}
                  </div>
                  <button
                    type="button"
                    onClick={dismissCoachmark}
                    aria-label={tg("dismissPanel")}
                    className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <h3 id="guide-coachmark-title" className="mt-2 text-sm font-semibold text-foreground">
                  {tg(`task_${activeCoachmarkTask.id}_title`)}
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {tg(`task_${activeCoachmarkTask.id}_how`)}
                </p>

                <div className="mt-3 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={openGuide}
                    className="text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {tg("panelTitle")}
                  </button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={dismissCoachmark}
                    className="h-8 rounded-lg px-3 text-xs"
                  >
                    <Check className="mr-1 h-3 w-3" aria-hidden />
                    {tg("dismissPanel")}
                  </Button>
                </div>
              </div>
            </section>
          ) : null}

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
                ref={(node) => {
                  panelRef.current = node;
                }}
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
                    aria-label={tg("dismissPanel")}
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
                                  ? "border-emerald-500 bg-emerald-500 text-primary-foreground"
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
