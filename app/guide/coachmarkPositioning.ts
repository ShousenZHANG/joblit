import type { OnboardingTask } from "@/lib/onboarding";

export type CoachmarkRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

export type CoachmarkLayout = {
  top: number;
  left: number;
  width: number;
  arrowLeft: number;
  placement: "above" | "below";
};

type Viewport = {
  width: number;
  height: number;
};

export function taskMatchesPath(
  task: OnboardingTask,
  pathname: string,
): boolean {
  return pathname === task.href || pathname.startsWith(`${task.href}/`);
}

export function sameCoachmarkRect(
  previous: CoachmarkRect | null,
  next: CoachmarkRect,
): boolean {
  return Boolean(
    previous &&
      Math.abs(previous.top - next.top) < 1 &&
      Math.abs(previous.left - next.left) < 1 &&
      Math.abs(previous.width - next.width) < 1 &&
      Math.abs(previous.height - next.height) < 1,
  );
}

export function calculateCoachmarkLayout(
  rect: CoachmarkRect | null,
  viewport: Viewport,
): CoachmarkLayout | null {
  if (!rect || viewport.width <= 0 || viewport.height <= 0) return null;

  const width = Math.min(320, viewport.width - 24);
  const estimatedHeight = 180;
  const left = Math.max(
    12,
    Math.min(
      rect.left + rect.width / 2 - width / 2,
      viewport.width - width - 12,
    ),
  );
  const placeBelow =
    rect.top + rect.height + estimatedHeight + 24 < viewport.height;
  const top = placeBelow
    ? rect.top + rect.height + 14
    : Math.max(12, rect.top - estimatedHeight - 14);
  const arrowLeft = Math.max(
    18,
    Math.min(rect.left + rect.width / 2 - left - 6, width - 30),
  );

  return {
    top,
    left,
    width,
    arrowLeft,
    placement: placeBelow ? "below" : "above",
  };
}
