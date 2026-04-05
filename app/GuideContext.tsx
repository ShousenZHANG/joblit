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
import { Sparkles, X, Briefcase, FileText, Puzzle } from "lucide-react";
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

type SpotlightRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

const GUIDE_CARD_WIDTH = 340;
const GUIDE_CARD_HEIGHT_ESTIMATE = 260;
const GUIDE_EDGE = 12;
const SPOTLIGHT_PADDING = 8;
const WELCOME_SHOWN_KEY = "joblit_guide_welcome_shown";

const GuideContext = createContext<GuideContextValue | null>(null);

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function sameRect(a: SpotlightRect | null, b: SpotlightRect | null) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (
    Math.abs(a.top - b.top) < 1 &&
    Math.abs(a.left - b.left) < 1 &&
    Math.abs(a.width - b.width) < 1 &&
    Math.abs(a.height - b.height) < 1
  );
}

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
  const pathname = usePathname();
  const userId = session?.user?.id ?? null;
  const tg = useTranslations("guide");

  const [loading, setLoading] = useState(false);
  const [state, setState] = useState<GuideState | null>(null);

  const [tourRunning, setTourRunning] = useState(false);
  const [tourStepIndex, setTourStepIndex] = useState(0);
  const [spotlightRect, setSpotlightRect] = useState<SpotlightRect | null>(null);
  const [targetMissing, setTargetMissing] = useState(false);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [welcomeVisible, setWelcomeVisible] = useState(false);

  const scrolledTargetKeyRef = useRef<string | null>(null);

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
        const isNewUser =
          resolved.stage === "NEW_USER" &&
          !resolved.dismissed &&
          !resolved.completedAt &&
          !resolved.isComplete;
        const alreadyShown = sessionStorage.getItem(WELCOME_SHOWN_KEY) === "1";
        if (isNewUser && !alreadyShown) {
          setWelcomeVisible(true);
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

  useEffect(() => {
    const syncViewport = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };
    syncViewport();
    window.addEventListener("resize", syncViewport);
    return () => {
      window.removeEventListener("resize", syncViewport);
    };
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setPrefersReducedMotion(mediaQuery.matches);
    update();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", update);
      return () => mediaQuery.removeEventListener("change", update);
    }

    mediaQuery.addListener(update);
    return () => mediaQuery.removeListener(update);
  }, []);

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

  const tourTaskId = useMemo<OnboardingTaskId | null>(() => {
    if (!tourRunning) return null;
    return ONBOARDING_TASKS[tourStepIndex]?.id ?? null;
  }, [tourRunning, tourStepIndex]);

  const activeTourTask = useMemo(() => getTaskById(tourTaskId), [tourTaskId]);

  const isTourTaskOnCurrentPage = useMemo(() => {
    if (!activeTourTask) return false;
    return pathname === activeTourTask.href || pathname.startsWith(`${activeTourTask.href}/`);
  }, [activeTourTask, pathname]);

  const stopTour = useCallback(() => {
    setTourRunning(false);
    setTourStepIndex(0);
    setSpotlightRect(null);
    setTargetMissing(false);
    scrolledTargetKeyRef.current = null;
  }, []);

  const startTour = useCallback(() => {
    const nextTask = activeTaskId ?? ONBOARDING_TASKS[0]?.id ?? null;
    const nextIndex = nextTask ? Math.max(0, ONBOARDING_TASKS.findIndex((t) => t.id === nextTask)) : 0;
    setTourStepIndex(nextIndex >= 0 ? nextIndex : 0);
    setTourRunning(true);
    void patchState({ type: "reopen" });
  }, [activeTaskId, patchState]);

  const locateTourTarget = useCallback(() => {
    if (!tourRunning || !tourTaskId) {
      setSpotlightRect(null);
      setTargetMissing(false);
      return;
    }
    const target = document.querySelector<HTMLElement>(`[data-guide-anchor="${tourTaskId}"]`);
    if (!target) {
      setSpotlightRect(null);
      setTargetMissing(true);
      return;
    }
    const rect = target.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) {
      setSpotlightRect(null);
      setTargetMissing(true);
      return;
    }
    const nextRect = {
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    };
    setSpotlightRect((prev) => (sameRect(prev, nextRect) ? prev : nextRect));
    setTargetMissing(false);
  }, [tourRunning, tourTaskId]);

  useEffect(() => {
    if (!tourRunning || !tourTaskId) return;

    locateTourTarget();
    const interval = window.setInterval(locateTourTarget, 120);
    const handleScroll = () => locateTourTarget();
    window.addEventListener("resize", locateTourTarget);
    window.addEventListener("scroll", handleScroll, true);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("resize", locateTourTarget);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [locateTourTarget, tourRunning, tourTaskId]);

  useEffect(() => {
    if (!tourRunning || !tourTaskId || !isTourTaskOnCurrentPage) return;
    const target = document.querySelector<HTMLElement>(`[data-guide-anchor="${tourTaskId}"]`);
    if (!target) return;

    const key = `${tourTaskId}:${pathname}`;
    if (scrolledTargetKeyRef.current === key) return;
    if (typeof target.scrollIntoView === "function") {
      target.scrollIntoView({
        behavior: prefersReducedMotion ? "auto" : "smooth",
        block: "center",
        inline: "nearest",
      });
    }
    scrolledTargetKeyRef.current = key;
  }, [isTourTaskOnCurrentPage, pathname, prefersReducedMotion, tourRunning, tourTaskId]);

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
    setWelcomeVisible(false);
    startTour();
  }, [startTour]);
  const closeGuide = stopTour;

  const isTaskHighlighted = useCallback(
    (taskId: OnboardingTaskId) => {
      if (!tourRunning || !tourTaskId || tourTaskId !== taskId) return false;
      const task = ONBOARDING_TASKS.find((item) => item.id === taskId);
      if (!task) return false;
      return pathname === task.href || pathname.startsWith(`${task.href}/`);
    },
    [pathname, tourRunning, tourTaskId],
  );

  const spotlightBox = useMemo(() => {
    if (!spotlightRect || viewport.width <= 0 || viewport.height <= 0) return null;
    const top = clamp(spotlightRect.top - SPOTLIGHT_PADDING, GUIDE_EDGE, viewport.height - GUIDE_EDGE);
    const left = clamp(spotlightRect.left - SPOTLIGHT_PADDING, GUIDE_EDGE, viewport.width - GUIDE_EDGE);
    const width = clamp(
      spotlightRect.width + SPOTLIGHT_PADDING * 2,
      24,
      viewport.width - left - GUIDE_EDGE,
    );
    const height = clamp(
      spotlightRect.height + SPOTLIGHT_PADDING * 2,
      24,
      viewport.height - top - GUIDE_EDGE,
    );
    return { top, left, width, height };
  }, [spotlightRect, viewport.height, viewport.width]);

  const coachLayout = useMemo(() => {
    if (!spotlightBox || viewport.width <= 0 || viewport.height <= 0) return null;
    const cardWidth = Math.min(GUIDE_CARD_WIDTH, viewport.width - GUIDE_EDGE * 2);
    const left = clamp(
      spotlightBox.left + spotlightBox.width / 2 - cardWidth / 2,
      GUIDE_EDGE,
      viewport.width - cardWidth - GUIDE_EDGE,
    );
    const canPlaceBelow =
      spotlightBox.top + spotlightBox.height + GUIDE_CARD_HEIGHT_ESTIMATE + 24 < viewport.height;
    const top = canPlaceBelow
      ? spotlightBox.top + spotlightBox.height + 16
      : clamp(
          spotlightBox.top - GUIDE_CARD_HEIGHT_ESTIMATE - 16,
          GUIDE_EDGE,
          viewport.height - GUIDE_CARD_HEIGHT_ESTIMATE - GUIDE_EDGE,
        );

    const arrowLeft = clamp(
      spotlightBox.left + spotlightBox.width / 2 - left - 8,
      18,
      cardWidth - 24,
    );

    return {
      top,
      left,
      width: cardWidth,
      arrowLeft,
      placement: canPlaceBelow ? "top" : "bottom",
    } as const;
  }, [spotlightBox, viewport.height, viewport.width]);

  const shouldHideCoachUntilAnchored = useMemo(() => {
    return isTourTaskOnCurrentPage && !targetMissing && !coachLayout;
  }, [coachLayout, isTourTaskOnCurrentPage, targetMissing]);

  const tourTotalSteps = ONBOARDING_TASKS.length;
  const tourStepNumber = tourRunning ? Math.min(tourTotalSteps, tourStepIndex + 1) : 0;

  const prevStep = useCallback(() => {
    if (!tourRunning) return;
    setTourStepIndex((prev) => Math.max(0, prev - 1));
    scrolledTargetKeyRef.current = null;
  }, [tourRunning]);

  const nextStep = useCallback(() => {
    if (!tourRunning) return;
    if (tourStepIndex >= tourTotalSteps - 1) {
      stopTour();
      return;
    }
    setTourStepIndex((prev) => Math.min(tourTotalSteps - 1, prev + 1));
    scrolledTargetKeyRef.current = null;
  }, [stopTour, tourRunning, tourStepIndex, tourTotalSteps]);

  useEffect(() => {
    if (!tourRunning || !activeTourTask) return;
    if (!isTourTaskOnCurrentPage) {
      router.push(activeTourTask.href);
    }
  }, [activeTourTask, isTourTaskOnCurrentPage, router, tourRunning]);

  useEffect(() => {
    if (!tourRunning) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        stopTour();
        return;
      }

      if (event.repeat) return;

      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const interactiveTag =
        tag === "input" || tag === "textarea" || tag === "select" || tag === "button" || tag === "a";
      const hasInteractiveRole = Boolean(target?.closest('[role="button"], [role="link"], [role="combobox"]'));
      if (target?.isContentEditable || interactiveTag || hasInteractiveRole) {
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        prevStep();
        return;
      }

      if (event.key === "ArrowRight" || event.key === "Enter") {
        event.preventDefault();
        nextStep();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [nextStep, prevStep, stopTour, tourRunning]);

  const value = useMemo<GuideContextValue>(
    () => ({
      loading,
      state,
      activeTaskId,
      tourRunning,
      tourTaskId,
      tourStep: tourStepNumber,
      openGuide,
      closeGuide,
      startTour,
      stopTour,
      nextStep,
      prevStep,
      markTaskComplete,
      isTaskHighlighted,
    }),
    [
      loading,
      state,
      activeTaskId,
      tourRunning,
      tourTaskId,
      tourStepNumber,
      openGuide,
      closeGuide,
      startTour,
      stopTour,
      nextStep,
      prevStep,
      markTaskComplete,
      isTaskHighlighted,
    ],
  );

  return (
    <GuideContext.Provider value={value}>
      {children}
      {userId ? (
        <>
          {welcomeVisible && !tourRunning && state && !state.isComplete && !state.dismissed ? (
            <>
              {/* Overlay */}
              <div
                className="fixed inset-0 z-[54] bg-slate-900/40 guide-fade-in"
                onClick={() => {
                  setWelcomeVisible(false);
                  void patchState({ type: "skip" });
                }}
              />
              {/* Centered modal */}
              <section
                data-testid="guide-welcome-card"
                className="fixed inset-0 z-[55] flex items-center justify-center p-4 pointer-events-none"
              >
                <div className="pointer-events-auto w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_32px_80px_-20px_rgba(15,23,42,0.35)] guide-scale-in">
                  {/* Header */}
                  <div className="mb-4 flex items-center justify-between">
                    <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                      <Sparkles className="h-3 w-3" />
                      {tg("badge")}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setWelcomeVisible(false);
                        void patchState({ type: "skip" });
                      }}
                      className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                      aria-label="Close"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <h3 className="text-lg font-bold text-slate-900">{tg("welcomeTitle")}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
                    {tg("welcomeDesc")}
                  </p>

                  {/* Feature highlights */}
                  <div className="mt-5 space-y-3">
                    {[
                      { icon: Briefcase, key: "welcomeFeature1" as const },
                      { icon: FileText, key: "welcomeFeature2" as const },
                      { icon: Puzzle, key: "welcomeFeature3" as const },
                    ].map(({ icon: Icon, key }) => (
                      <div key={key} className="flex items-start gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50">
                          <Icon className="h-4 w-4 text-emerald-600" />
                        </div>
                        <p className="pt-1 text-sm text-slate-600">{tg(key)}</p>
                      </div>
                    ))}
                  </div>

                  {/* Progress dots */}
                  <div className="mt-5 flex gap-1">
                    {Array.from({ length: tourTotalSteps }).map((_, i) => (
                      <div
                        key={i}
                        className={`h-1.5 rounded-full transition-all ${i === 0 ? "bg-emerald-400 w-5" : "bg-slate-200 w-1.5"}`}
                      />
                    ))}
                  </div>

                  {/* Actions */}
                  <div className="mt-5 flex items-center gap-3">
                    <Button
                      type="button"
                      size="sm"
                      className="h-10 flex-1 rounded-xl text-sm font-semibold"
                      onClick={openGuide}
                    >
                      {tg("startTour")}
                    </Button>
                    <button
                      type="button"
                      onClick={() => {
                        setWelcomeVisible(false);
                        void patchState({ type: "skip" });
                      }}
                      className="h-10 rounded-xl px-4 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700"
                    >
                      {tg("maybeLater")}
                    </button>
                  </div>
                </div>
              </section>
            </>
          ) : null}

          {tourRunning && activeTourTask ? (
            <>
              <div className="pointer-events-none fixed inset-0 z-[60]">
                {spotlightBox ? (
                  <div
                    className={`absolute rounded-2xl border border-emerald-300/90 bg-transparent shadow-[0_0_0_9999px_rgba(15,23,42,0.35)] ${
                      prefersReducedMotion ? "" : "transition-all duration-150 ease-out"
                    }`}
                    style={{
                      top: spotlightBox.top,
                      left: spotlightBox.left,
                      width: spotlightBox.width,
                      height: spotlightBox.height,
                    }}
                  />
                ) : (
                  <div className="absolute inset-0 bg-slate-900/35" />
                )}
              </div>

              <section
                className={`fixed z-[70] rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-[0_24px_60px_-34px_rgba(15,23,42,0.45)] backdrop-blur guide-tour-enter ${
                  prefersReducedMotion ? "" : "transition-[top,left] duration-150 ease-out"
                } ${shouldHideCoachUntilAnchored ? "pointer-events-none opacity-0" : ""}`}
                style={
                  coachLayout
                    ? {
                        top: coachLayout.top,
                        left: coachLayout.left,
                        width: coachLayout.width,
                      }
                    : {
                        top: GUIDE_EDGE + 72,
                        right: GUIDE_EDGE,
                        width: Math.min(GUIDE_CARD_WIDTH, viewport.width - GUIDE_EDGE * 2),
                      }
                }
              >
                {coachLayout ? (
                  <div
                    className={[
                      "absolute h-3 w-3 rotate-45 border border-slate-200 bg-white",
                      coachLayout.placement === "top" ? "-top-1.5 border-l border-t border-r-0 border-b-0" : "-bottom-1.5 border-r border-b border-l-0 border-t-0",
                    ].join(" ")}
                    style={{ left: coachLayout.arrowLeft }}
                  />
                ) : null}

                <section data-testid="guide-tour-card">
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div className="inline-flex items-center gap-1 rounded-full border border-emerald-100 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                      <Sparkles className="h-3 w-3" />
                      {tg("tourBadge")}
                    </div>
                    <button
                      type="button"
                      aria-label="Exit tour"
                      onClick={stopTour}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:text-slate-700"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="mb-2 flex items-center justify-between text-[11px] text-slate-500">
                    <span className="uppercase tracking-wide">
                      {tg("stepOf", { current: tourStepNumber, total: tourTotalSteps })}
                    </span>
                    {state ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                        {state.completedCount}/{state.totalCount}
                      </span>
                    ) : null}
                  </div>

                  <div className="mb-2 flex gap-1">
                    {Array.from({ length: tourTotalSteps }).map((_, i) => (
                      <div
                        key={i}
                        className={`h-1.5 rounded-full transition-all ${i < tourStepNumber ? "bg-emerald-500 w-4" : "bg-slate-200 w-1.5"}`}
                      />
                    ))}
                  </div>

                  <h3 className="text-sm font-semibold text-slate-900">{tg(`task_${activeTourTask.id}_title`)}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">{tg(`task_${activeTourTask.id}_desc`)}</p>

                  {!isTourTaskOnCurrentPage ? (
                    <p className="mt-2 text-[11px] text-slate-500">{tg("navigating")}</p>
                  ) : targetMissing ? (
                    <p className="mt-2 text-[11px] text-slate-500">
                      {tg("waitingForElement")}
                    </p>
                  ) : null}

                  <div className="mt-4 flex items-center justify-between gap-3">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={stopTour}
                      className="h-9 px-2 text-xs"
                    >
                      {tg("endTour")}
                    </Button>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={prevStep}
                        disabled={tourStepIndex <= 0}
                        className="h-9 rounded-xl px-3 text-xs"
                      >
                        {tg("back")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={nextStep}
                        className="h-9 rounded-xl px-3 text-xs"
                      >
                        {tourStepIndex >= tourTotalSteps - 1 ? tg("finish") : tg("next")}
                      </Button>
                    </div>
                  </div>
                  <p className="mt-2 text-[11px] text-slate-500">{tg("shortcuts")}</p>
                </section>
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
