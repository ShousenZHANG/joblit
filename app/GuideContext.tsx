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
import { useMarket } from "@/hooks/useMarket";
import { useTranslations } from "next-intl";
import {
  ArrowRight,
  Check,
  CircleHelp,
  Clock,
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
import { GuideWelcome } from "@/components/guide/GuideWelcome";
import { GuideTaskList } from "@/components/guide/GuideTaskList";
import { GuideComplete } from "@/components/guide/GuideComplete";
import { minutesLeft } from "@/components/guide/guideMeta";

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
  openGuide: () => void;
  closeGuide: () => void;
  markTaskComplete: (taskId: OnboardingTaskId) => void;
  isTaskHighlighted: (taskId: OnboardingTaskId) => boolean;
};

const WELCOME_SHOWN_KEY = "joblit_guide_welcome_shown";

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
  // CN market support is limited to Resume + Discover; the onboarding guide is
  // a Jobs/Fetch-centric flow, so it's disabled there entirely.
  const isCN = useMarket() === "CN";
  const tg = useTranslations("guide");

  const [loading, setLoading] = useState(false);
  const [state, setState] = useState<GuideState | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  // Which view the Quick Start panel shows. The branded welcome view is only
  // auto-shown on a brand-new user's first visit of the session; every
  // explicit open (nav button, floating widget, "?") goes straight to the
  // checklist so returning users never re-see the intro.
  const [panelView, setPanelView] = useState<"welcome" | "checklist">("checklist");
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

  // Full modal focus management for the aria-modal Quick Start panel:
  //   1. capture the element that had focus before the panel opened and
  //      restore it when the panel closes (WCAG 2.4.3 Focus Order),
  //   2. move focus into the panel on open,
  //   3. trap Tab / Shift+Tab so focus cycles between the first and last
  //      focusable descendant instead of escaping to the page behind the
  //      modal overlay (ARIA Authoring Practices — Dialog Modal pattern).
  // Escape-to-close is handled by the global "?" shortcut listener below; we
  // also guard Escape here so it works even when no userId path is active.
  useEffect(() => {
    if (!panelOpen) return;
    const node = panelRef.current;
    if (!node) return;

    const previouslyFocused =
      typeof document !== "undefined"
        ? (document.activeElement as HTMLElement | null)
        : null;

    const FOCUSABLE_SELECTOR =
      "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

    const getFocusable = (): HTMLElement[] => {
      const candidates = Array.from(
        node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((el) => !el.hasAttribute("hidden"));
      // `offsetParent` is the cheap browser visibility check, but jsdom (and
      // any no-layout environment) returns null for everything. Only filter
      // on it when at least one candidate reports layout — otherwise keep all
      // candidates so the trap still works under test renderers.
      const layoutAvailable = candidates.some((el) => el.offsetParent !== null);
      return layoutAvailable
        ? candidates.filter(
            (el) => el.offsetParent !== null || el === document.activeElement,
          )
        : candidates;
    };

    // Move focus into the panel on open.
    const initial = getFocusable()[0] ?? node;
    initial.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setPanelOpen(false);
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = getFocusable();
      if (focusable.length === 0) {
        // Nothing focusable inside — keep focus on the panel itself.
        event.preventDefault();
        node.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey) {
        if (active === first || !node.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !node.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };

    node.addEventListener("keydown", onKeyDown);
    return () => {
      node.removeEventListener("keydown", onKeyDown);
      // Restore focus to the trigger that opened the panel, when it is still
      // in the document and focusable.
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
    };
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

  const fetchState = useCallback(async (signal?: AbortSignal) => {
    if (!userId || isCN) {
      if (!signal?.aborted) {
        setState(null);
        setLoading(false);
      }
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/onboarding/state", {
        cache: "no-store",
        signal,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to load onboarding state");
      if (signal?.aborted) return;
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
          setPanelView("welcome");
          setPanelOpen(true);
          markWelcomeShown();
        }
        return resolved;
      });
    } catch {
      if (signal?.aborted) return;
      setState(null);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [userId, isCN]);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) void fetchState(controller.signal);
    });
    return () => controller.abort();
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
    setPanelView("checklist");
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
    if (!userId || isCN) return;

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
  }, [panelOpen, userId, isCN]);

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

  const value = useMemo<GuideContextValue>(
    () => ({
      loading,
      state,
      activeTaskId,
      openGuide,
      closeGuide,
      markTaskComplete,
      // Drives the emerald highlight ring on the resume Save / fetch run /
      // job generate controls when the matching coachmark is active.
      isTaskHighlighted,
    }),
    [activeTaskId, closeGuide, isTaskHighlighted, loading, markTaskComplete, openGuide, state],
  );

  // Clear the coachmark if the user navigates to a page that isn't the
  // task's home page — they've moved on, so the inline guide should too.
  useEffect(() => {
    if (!coachmarkTaskId) return;
    const task = ONBOARDING_TASKS.find((t) => t.id === coachmarkTaskId);
    if (!task) return;
    const onTaskPage = pathname === task.href || pathname.startsWith(`${task.href}/`);
    if (!onTaskPage) {
      let cancelled = false;
      queueMicrotask(() => {
        if (cancelled) return;
        setCoachmarkTaskId(null);
        setCoachmarkRect(null);
      });
      return () => {
        cancelled = true;
      };
    }
  }, [coachmarkTaskId, pathname]);

  // Locate the coachmark target from observable browser events. This avoids
  // a permanent polling interval while still following scroll, resize, and
  // page-level DOM changes triggered by route transitions.
  useEffect(() => {
    if (!coachmarkTaskId) return;
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
            <>
              {/* Beacon — a breathing emerald spotlight ring drawn over the
                  actual control so the eye is pulled to the thing to click,
                  not just the tooltip. Non-blocking (pointer-events-none) so
                  the user can still interact with the highlighted element. */}
              {coachmarkRect ? (
                <span
                  aria-hidden
                  data-testid="guide-beacon"
                  className="pointer-events-none fixed z-[57] rounded-xl ring-2 ring-emerald-500/70 guide-beacon motion-reduce:animate-none"
                  style={{
                    top: coachmarkRect.top - 4,
                    left: coachmarkRect.left - 4,
                    width: coachmarkRect.width + 8,
                    height: coachmarkRect.height + 8,
                  }}
                />
              ) : null}
              <section
                ref={(node) => {
                  coachmarkRef.current = node;
                }}
                data-testid="guide-coachmark"
                role="dialog"
                aria-modal="false"
                aria-labelledby="guide-coachmark-title"
                className="pointer-events-auto fixed z-[58] overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-[0_28px_70px_-30px_rgba(15,23,42,0.55)] guide-tour-enter motion-reduce:animate-none"
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
                    <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/12 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-[9px] font-extrabold text-white">
                        {coachmarkStepNumber}
                      </span>
                      {tg("stepOf", { current: coachmarkStepNumber, total: state.totalCount })}
                    </div>
                    <button
                      type="button"
                      onClick={dismissCoachmark}
                      aria-label={tg("gotIt")}
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
                      {tg("viewAllSteps")}
                    </button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={dismissCoachmark}
                      className="h-8 rounded-lg bg-emerald-600 px-3 text-xs font-semibold hover:bg-emerald-700"
                    >
                      <Check className="mr-1 h-3 w-3" aria-hidden />
                      {tg("gotIt")}
                    </Button>
                  </div>
                </div>
              </section>
            </>
          ) : null}

          {/* Floating launcher — visible whenever the panel is closed and
              progress is incomplete. Click reopens the Quick Start panel. */}
          {!panelOpen && !state.isComplete ? (
            <button
              type="button"
              onClick={openGuide}
              data-testid="guide-floating-widget"
              aria-label={tg("panelTitle")}
              className="group fixed bottom-5 right-5 z-[52] inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-card/95 px-3 py-2 text-card-foreground shadow-[0_14px_34px_-16px_rgba(5,150,105,0.4),0_2px_8px_-3px_rgba(15,23,42,0.12)] backdrop-blur-sm transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[0_22px_44px_-20px_rgba(5,150,105,0.55)] active:scale-[0.97] motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100 motion-reduce:transition-none"
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
                <span className="rounded-full bg-emerald-500/12 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
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
                tabIndex={-1}
                className="fixed inset-x-0 bottom-0 z-[61] flex max-h-[85dvh] flex-col rounded-t-2xl border border-border bg-card text-card-foreground shadow-[0_24px_60px_-30px_rgba(15,23,42,0.45)] guide-scale-in md:bottom-5 md:left-auto md:right-5 md:top-auto md:max-h-[min(640px,calc(100dvh-2.5rem))] md:w-[380px] md:rounded-2xl focus:outline-none"
                style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
              >
                {panelView === "welcome" && !state.isComplete ? (
                  <>
                    <button
                      type="button"
                      onClick={closeGuide}
                      className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      aria-label={tg("dismissPanel")}
                    >
                      <X className="h-4 w-4" />
                    </button>
                    <h2 id="guide-panel-title" className="sr-only">
                      {tg("welcomeTitle")}
                    </h2>
                    <GuideWelcome
                      onStart={() => setPanelView("checklist")}
                      onSkip={dismissGuide}
                    />
                  </>
                ) : state.isComplete ? (
                  <>
                    <button
                      type="button"
                      onClick={closeGuide}
                      className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      aria-label={tg("dismissPanel")}
                    >
                      <X className="h-4 w-4" />
                    </button>
                    <h2 id="guide-panel-title" className="sr-only">
                      {tg("allDone")}
                    </h2>
                    <GuideComplete onDismiss={dismissGuide} />
                  </>
                ) : (
                  <>
                    {/* Header — branded gradient wash */}
                    <header className="relative overflow-hidden border-b border-border/60 px-5 pb-4 pt-4">
                      <div
                        aria-hidden
                        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-emerald-50 via-transparent to-transparent dark:from-emerald-500/10"
                      />
                      <div className="relative flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                            <Sparkles className="h-3 w-3" aria-hidden />
                            {tg("badge")}
                          </div>
                          <h2
                            id="guide-panel-title"
                            className="mt-1.5 text-base font-bold tracking-tight text-foreground"
                          >
                            {tg("panelTitle")}
                          </h2>
                          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                            {tg("panelSubtitle")}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={closeGuide}
                          className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          aria-label={tg("dismissPanel")}
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    </header>

                    {/* Progress — ring percent + gradient bar + time-left */}
                    <div className="flex items-center gap-3 px-5 pt-3.5">
                      <div className="relative flex h-11 w-11 shrink-0 items-center justify-center text-emerald-500">
                        <svg className="absolute h-11 w-11 -rotate-90" viewBox="0 0 44 44" aria-hidden>
                          <circle cx="22" cy="22" r="18" fill="none" stroke="currentColor" strokeOpacity="0.12" strokeWidth="4" />
                          <circle
                            cx="22"
                            cy="22"
                            r="18"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="4"
                            strokeLinecap="round"
                            strokeDasharray={`${(state.completedCount / state.totalCount) * 113.097} 113.097`}
                            className="transition-[stroke-dasharray] duration-500 ease-out"
                          />
                        </svg>
                        <span className="text-[11px] font-bold text-foreground">
                          {Math.round((state.completedCount / state.totalCount) * 100)}%
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div
                          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
                          role="progressbar"
                          aria-valuenow={state.completedCount}
                          aria-valuemin={0}
                          aria-valuemax={state.totalCount}
                        >
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-[width] duration-500 ease-out"
                            style={{ width: `${(state.completedCount / state.totalCount) * 100}%` }}
                          />
                        </div>
                        <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
                          <span className="font-medium text-foreground">
                            {state.completedCount} / {state.totalCount}
                          </span>
                          {minutesLeft(state.checklist) > 0 ? (
                            <span className="inline-flex items-center gap-1">
                              <Clock className="h-3 w-3" aria-hidden />
                              {tg("timeLeft", { min: minutesLeft(state.checklist) })}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <GuideTaskList
                      checklist={state.checklist}
                      activeTaskId={activeTaskId}
                      onNavigate={navigateToTask}
                    />

                    {/* Footer hint */}
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
                  </>
                )}
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
    openGuide: () => {},
    closeGuide: () => {},
    markTaskComplete: () => {},
    isTaskHighlighted: () => false,
  };
}
