import {
  sameCoachmarkRect,
  type CoachmarkRect,
} from "./coachmarkPositioning";
import type { Dispatch, SetStateAction } from "react";

type ObserveCoachmarkTargetOptions = {
  taskId: string;
  onRect: (rect: CoachmarkRect | null) => void;
  onTimeout: () => void;
};

function requestGuideFrame(callback: FrameRequestCallback): number {
  if (window.requestAnimationFrame) {
    return window.requestAnimationFrame(callback);
  }
  return window.setTimeout(() => callback(performance.now()), 16);
}

function cancelGuideFrame(frame: number) {
  if (window.cancelAnimationFrame) {
    window.cancelAnimationFrame(frame);
    return;
  }
  window.clearTimeout(frame);
}

function rectFromTarget(target: HTMLElement): CoachmarkRect | null {
  const rect = target.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return null;
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}

function createFrameScheduler(callback: () => void) {
  let frame = 0;
  const schedule = () => {
    if (frame) return;
    frame = requestGuideFrame(() => {
      frame = 0;
      callback();
    });
  };
  return {
    schedule,
    cancel: () => {
      if (frame) cancelGuideFrame(frame);
      frame = 0;
    },
  };
}

function createTargetObservers(scheduleTarget: () => void) {
  let observedTarget: HTMLElement | null = null;
  const resizeObserver =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(scheduleTarget);
  const mutationObserver =
    typeof MutationObserver === "undefined"
      ? null
      : new MutationObserver(scheduleTarget);
  return {
    observe(target: HTMLElement | null) {
      if (!target || !resizeObserver || observedTarget === target) return;
      resizeObserver.disconnect();
      resizeObserver.observe(target);
      observedTarget = target;
    },
    start() {
      mutationObserver?.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "style", "data-guide-anchor"],
      });
    },
    disconnect() {
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    },
  };
}

function bindCoachmarkEvents(schedule: () => void): () => void {
  window.addEventListener("scroll", schedule, { capture: true, passive: true });
  window.addEventListener("resize", schedule, { passive: true });
  return () => {
    window.removeEventListener("scroll", schedule, true);
    window.removeEventListener("resize", schedule);
  };
}

export function observeCoachmarkTarget({
  taskId,
  onRect,
  onTimeout,
}: ObserveCoachmarkTargetOptions): () => void {
  let attempts = 0;
  let disposed = false;
  let retryTimer = 0;
  let schedule = () => {};
  const observers = createTargetObservers(() => schedule());

  const locate = () => {
    const target = document.querySelector<HTMLElement>(
      `[data-guide-anchor="${taskId}"]`,
    );
    observers.observe(target);
    const rect = target ? rectFromTarget(target) : null;
    if (rect) {
      onRect(rect);
      return;
    }
    onRect(null);
    attempts += 1;
    if (attempts >= 30) {
      disposed = true;
      onTimeout();
      return;
    }
    retryTimer = window.setTimeout(schedule, 200);
  };

  const scheduler = createFrameScheduler(locate);
  schedule = () => {
    if (!disposed) scheduler.schedule();
  };
  schedule();
  observers.start();
  const unbindEvents = bindCoachmarkEvents(schedule);

  return () => {
    disposed = true;
    scheduler.cancel();
    window.clearTimeout(retryTimer);
    observers.disconnect();
    unbindEvents();
  };
}

export function updateCoachmarkRect(
  update: Dispatch<SetStateAction<CoachmarkRect | null>>,
  next: CoachmarkRect | null,
) {
  update((previous) => {
    if (!next) return previous ? null : previous;
    return sameCoachmarkRect(previous, next) ? previous : next;
  });
}
