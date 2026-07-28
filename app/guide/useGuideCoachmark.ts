"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import {
  ONBOARDING_TASKS,
  type OnboardingTask,
  type OnboardingTaskId,
} from "@/lib/onboarding";
import {
  calculateCoachmarkLayout,
  taskMatchesPath,
  type CoachmarkLayout,
  type CoachmarkRect,
} from "./coachmarkPositioning";
import {
  observeCoachmarkTarget,
  updateCoachmarkRect,
} from "./coachmarkTarget";

const COACHMARK_DISMISS_KEY = "joblit_guide_coachmark_dismissed";

type CoachmarkCommands = {
  arm: (taskId: OnboardingTaskId) => void;
  dismiss: () => void;
  completeTask: (taskId: OnboardingTaskId) => void;
  clear: () => void;
};

type GuideCoachmarkModel = CoachmarkCommands & {
  task: OnboardingTask | null;
  taskId: OnboardingTaskId | null;
  stepNumber: number;
  rect: CoachmarkRect | null;
  layout: CoachmarkLayout | null;
  elementRef: MutableRefObject<HTMLElement | null>;
  isHighlighted: (taskId: OnboardingTaskId) => boolean;
};

function readDismissedCoachmarks(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.sessionStorage.getItem(COACHMARK_DISMISS_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? new Set(parsed.filter((value): value is string => typeof value === "string"))
      : new Set();
  } catch {
    return new Set();
  }
}

function writeDismissedCoachmarks(dismissed: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      COACHMARK_DISMISS_KEY,
      JSON.stringify(Array.from(dismissed)),
    );
  } catch {
    // sessionStorage can be unavailable in privacy-restricted environments.
  }
}

function useGuideViewport() {
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  useEffect(() => {
    let frame = 0;
    const requestFrame = window.requestAnimationFrame
      ? window.requestAnimationFrame.bind(window)
      : (callback: FrameRequestCallback) =>
          window.setTimeout(() => callback(performance.now()), 16);
    const cancelFrame = window.cancelAnimationFrame
      ? window.cancelAnimationFrame.bind(window)
      : window.clearTimeout.bind(window);
    const sync = () => {
      if (frame) cancelFrame(frame);
      frame = requestFrame(() => {
        frame = 0;
        setViewport({ width: window.innerWidth, height: window.innerHeight });
      });
    };
    sync();
    window.addEventListener("resize", sync, { passive: true });
    return () => {
      if (frame) cancelFrame(frame);
      window.removeEventListener("resize", sync);
    };
  }, []);
  return viewport;
}

function useCoachmarkFocus(
  taskId: OnboardingTaskId | null,
  rect: CoachmarkRect | null,
  elementRef: MutableRefObject<HTMLElement | null>,
  focusedTaskRef: MutableRefObject<OnboardingTaskId | null>,
) {
  useEffect(() => {
    if (!taskId || !rect || focusedTaskRef.current === taskId) return;
    const focusable = elementRef.current?.querySelector<HTMLElement>(
      "button, [href], [tabindex]:not([tabindex='-1'])",
    );
    if (!focusable) return;
    focusable.focus({ preventScroll: true });
    focusedTaskRef.current = taskId;
  }, [elementRef, focusedTaskRef, rect, taskId]);
}

function useCoachmarkRouteLifecycle(
  task: OnboardingTask | null,
  pathname: string,
  pendingRef: MutableRefObject<OnboardingTaskId | null>,
  clear: () => void,
) {
  useEffect(() => {
    if (!task) return;
    if (taskMatchesPath(task, pathname)) {
      pendingRef.current = null;
      return;
    }
    if (pendingRef.current === task.id) {
      const timeout = window.setTimeout(clear, 5000);
      return () => window.clearTimeout(timeout);
    }
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) clear();
    });
    return () => {
      cancelled = true;
    };
  }, [clear, pathname, pendingRef, task]);
}

function useCoachmarkTarget(
  task: OnboardingTask | null,
  pathname: string,
  setRect: Dispatch<SetStateAction<CoachmarkRect | null>>,
  clear: () => void,
) {
  useEffect(() => {
    if (!task || !taskMatchesPath(task, pathname)) return;
    return observeCoachmarkTarget({
      taskId: task.id,
      onRect: (next) => updateCoachmarkRect(setRect, next),
      onTimeout: clear,
    });
  }, [clear, pathname, setRect, task]);
}

function useCoachmarkCommands(
  taskId: OnboardingTaskId | null,
  setTaskId: Dispatch<SetStateAction<OnboardingTaskId | null>>,
  setRect: Dispatch<SetStateAction<CoachmarkRect | null>>,
  dismissedRef: MutableRefObject<Set<string>>,
  pendingRef: MutableRefObject<OnboardingTaskId | null>,
  focusedTaskRef: MutableRefObject<OnboardingTaskId | null>,
): CoachmarkCommands {
  const clear = useCallback(() => {
    pendingRef.current = null;
    setTaskId(null);
    setRect(null);
  }, [pendingRef, setRect, setTaskId]);
  const arm = useCallback((nextTaskId: OnboardingTaskId) => {
    const dismissed = new Set(dismissedRef.current);
    dismissed.delete(nextTaskId);
    dismissedRef.current = dismissed;
    writeDismissedCoachmarks(dismissed);
    focusedTaskRef.current = null;
    pendingRef.current = nextTaskId;
    setTaskId(nextTaskId);
    setRect(null);
  }, [dismissedRef, focusedTaskRef, pendingRef, setRect, setTaskId]);
  const dismiss = useCallback(() => {
    if (taskId) {
      const dismissed = new Set(dismissedRef.current);
      dismissed.add(taskId);
      dismissedRef.current = dismissed;
      writeDismissedCoachmarks(dismissed);
    }
    clear();
  }, [clear, dismissedRef, taskId]);
  const completeTask = useCallback((completedTaskId: OnboardingTaskId) => {
    if (taskId === completedTaskId) clear();
  }, [clear, taskId]);
  return useMemo(
    () => ({ arm, dismiss, completeTask, clear }),
    [arm, clear, completeTask, dismiss],
  );
}

export function useGuideCoachmark(pathname: string): GuideCoachmarkModel {
  const [taskId, setTaskId] = useState<OnboardingTaskId | null>(null);
  const [rect, setRect] = useState<CoachmarkRect | null>(null);
  const viewport = useGuideViewport();
  const dismissedRef = useRef<Set<string>>(new Set());
  const elementRef = useRef<HTMLElement | null>(null);
  const focusedTaskRef = useRef<OnboardingTaskId | null>(null);
  const pendingRef = useRef<OnboardingTaskId | null>(null);
  const task = useMemo(
    () => ONBOARDING_TASKS.find((candidate) => candidate.id === taskId) ?? null,
    [taskId],
  );
  useEffect(() => {
    dismissedRef.current = readDismissedCoachmarks();
  }, []);
  const commands = useCoachmarkCommands(
    taskId,
    setTaskId,
    setRect,
    dismissedRef,
    pendingRef,
    focusedTaskRef,
  );
  useCoachmarkFocus(taskId, rect, elementRef, focusedTaskRef);
  useCoachmarkRouteLifecycle(task, pathname, pendingRef, commands.clear);
  useCoachmarkTarget(task, pathname, setRect, commands.clear);
  const isHighlighted = useCallback(
    (candidateId: OnboardingTaskId) =>
      Boolean(task?.id === candidateId && taskMatchesPath(task, pathname)),
    [pathname, task],
  );
  return {
    ...commands,
    task,
    taskId,
    stepNumber: task ? ONBOARDING_TASKS.indexOf(task) + 1 : 0,
    rect,
    layout: calculateCoachmarkLayout(rect, viewport),
    elementRef,
    isHighlighted,
  };
}
