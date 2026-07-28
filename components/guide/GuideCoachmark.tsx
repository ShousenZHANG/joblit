"use client";

import type { MutableRefObject } from "react";
import { Check, X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { GuideJourneyState } from "@/app/guide/guideJourney";
import type {
  CoachmarkLayout,
  CoachmarkRect,
} from "@/app/guide/coachmarkPositioning";
import { Button } from "@/components/ui/button";
import {
  COARSE_POINTER_MIN_HEIGHT,
  COARSE_POINTER_TARGET,
} from "@/components/ui/touchTarget";
import { cn } from "@/lib/utils";
import type { OnboardingTask } from "@/lib/onboarding";

type GuideCoachmarkProps = {
  task: OnboardingTask;
  stepNumber: number;
  journey: GuideJourneyState;
  rect: CoachmarkRect | null;
  layout: CoachmarkLayout;
  elementRef: MutableRefObject<HTMLElement | null>;
  onDismiss: () => void;
  onViewAll: () => void;
};

function GuideBeacon({ rect }: { rect: CoachmarkRect }) {
  return (
    <span
      aria-hidden
      data-testid="guide-beacon"
      className="pointer-events-none fixed z-[57] rounded-xl ring-2 ring-emerald-500/70 guide-beacon motion-reduce:animate-none"
      style={{
        top: rect.top - 4,
        left: rect.left - 4,
        width: rect.width + 8,
        height: rect.height + 8,
      }}
    />
  );
}

function GuideCoachmarkArrow({ layout }: { layout: CoachmarkLayout }) {
  return (
    <span
      aria-hidden
      className={cn(
        "absolute h-3 w-3 rotate-45 border bg-card",
        layout.placement === "below"
          ? "-top-1.5 border-b-transparent border-r-transparent border-border"
          : "-bottom-1.5 border-t-transparent border-l-transparent border-border",
      )}
      style={{ left: layout.arrowLeft }}
    />
  );
}

function GuideCoachmarkHeader({
  stepNumber,
  totalCount,
  onDismiss,
}: {
  stepNumber: number;
  totalCount: number;
  onDismiss: () => void;
}) {
  const t = useTranslations("guide");
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/12 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-[9px] font-extrabold text-white">
          {stepNumber}
        </span>
        {t("stepOf", { current: stepNumber, total: totalCount })}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t("gotIt")}
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none",
          COARSE_POINTER_TARGET,
        )}
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

function GuideCoachmarkActions({
  onDismiss,
  onViewAll,
}: {
  onDismiss: () => void;
  onViewAll: () => void;
}) {
  const t = useTranslations("guide");
  return (
    <div className="mt-3 flex items-center justify-between gap-2">
      <button
        type="button"
        onClick={onViewAll}
        className={cn(
          "inline-flex items-center text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none",
          COARSE_POINTER_MIN_HEIGHT,
        )}
      >
        {t("viewAllSteps")}
      </button>
      <Button
        type="button"
        size="sm"
        onClick={onDismiss}
        className={cn(
          "h-8 rounded-lg bg-emerald-600 px-3 text-xs font-semibold hover:bg-emerald-700 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          COARSE_POINTER_MIN_HEIGHT,
        )}
      >
        <Check className="mr-1 h-3 w-3" aria-hidden />
        {t("gotIt")}
      </Button>
    </div>
  );
}

export function GuideCoachmark({
  task,
  stepNumber,
  journey,
  rect,
  layout,
  elementRef,
  onDismiss,
  onViewAll,
}: GuideCoachmarkProps) {
  const t = useTranslations("guide");
  return (
    <>
      {rect ? <GuideBeacon rect={rect} /> : null}
      <section
        ref={elementRef}
        data-testid="guide-coachmark"
        role="dialog"
        aria-modal="false"
        aria-labelledby="guide-coachmark-title"
        className="pointer-events-auto fixed z-[58] overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-[0_28px_70px_-30px_rgba(15,23,42,0.55)] guide-tour-enter motion-reduce:animate-none"
        style={{ top: layout.top, left: layout.left, width: layout.width }}
      >
        <GuideCoachmarkArrow layout={layout} />
        <div className="p-4">
          <GuideCoachmarkHeader
            stepNumber={stepNumber}
            totalCount={journey.totalCount}
            onDismiss={onDismiss}
          />
          <h3
            id="guide-coachmark-title"
            className="mt-2 text-sm font-semibold text-foreground"
          >
            {t(`task_${task.id}_title`)}
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {t(`task_${task.id}_how`)}
          </p>
          <GuideCoachmarkActions
            onDismiss={onDismiss}
            onViewAll={onViewAll}
          />
        </div>
      </section>
    </>
  );
}
