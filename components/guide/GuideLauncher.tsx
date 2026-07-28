"use client";

import { ArrowRight, CircleHelp } from "lucide-react";
import { useTranslations } from "next-intl";
import type { GuideJourneyState } from "@/app/guide/guideJourney";
import { COARSE_POINTER_MIN_HEIGHT } from "@/components/ui/touchTarget";
import { cn } from "@/lib/utils";
import type { OnboardingTaskId } from "@/lib/onboarding";

type GuideLauncherProps = {
  journey: GuideJourneyState;
  activeTaskId: OnboardingTaskId | null;
  onOpen: () => void;
};

function GuideLauncherProgress({ journey }: { journey: GuideJourneyState }) {
  const progress = journey.totalCount
    ? (journey.completedCount / journey.totalCount) * 69.115
    : 0;
  return (
    <span className="relative flex h-7 w-7 items-center justify-center">
      <svg
        className="absolute h-7 w-7 -rotate-90"
        viewBox="0 0 28 28"
        aria-hidden
      >
        <circle cx="14" cy="14" r="11" fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth="2.5" />
        <circle cx="14" cy="14" r="11" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={`${progress} 69.115`} className="text-emerald-500 transition-[stroke-dasharray] duration-500 ease-out motion-reduce:transition-none" />
      </svg>
      <CircleHelp
        className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400"
        aria-hidden
      />
    </span>
  );
}

function GuideLauncherLabel({
  journey,
  activeTaskId,
}: Pick<GuideLauncherProps, "journey" | "activeTaskId">) {
  const t = useTranslations("guide");
  return (
    <span className="flex items-center gap-1.5 text-xs font-semibold">
      <span className="hidden sm:inline">
        {activeTaskId
          ? t("nextLabel", { title: t(`task_${activeTaskId}_title`) })
          : t("panelTitle")}
      </span>
      <span className="rounded-full bg-emerald-500/12 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
        {journey.completedCount}/{journey.totalCount}
      </span>
      <ArrowRight
        className="h-3 w-3 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
        aria-hidden
      />
    </span>
  );
}

export function GuideLauncher({
  journey,
  activeTaskId,
  onOpen,
}: GuideLauncherProps) {
  const t = useTranslations("guide");
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="guide-floating-widget"
      aria-label={t("panelTitle")}
      className={cn(
        "group fixed bottom-5 right-5 z-[52] inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-card/95 px-3 py-2 text-card-foreground shadow-[0_14px_34px_-16px_rgba(5,150,105,0.4),0_2px_8px_-3px_rgba(15,23,42,0.12)] backdrop-blur-sm transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[0_22px_44px_-20px_rgba(5,150,105,0.55)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-[0.97] motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100 motion-reduce:transition-none",
        COARSE_POINTER_MIN_HEIGHT,
      )}
      style={{
        right: "max(1.25rem, env(safe-area-inset-right))",
        paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))",
      }}
    >
      <GuideLauncherProgress journey={journey} />
      <GuideLauncherLabel
        journey={journey}
        activeTaskId={activeTaskId}
      />
    </button>
  );
}
