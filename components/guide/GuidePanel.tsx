"use client";

import { useRef, type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Clock, Sparkles, X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { GuideJourneyState } from "@/app/guide/guideJourney";
import {
  COARSE_POINTER_TARGET,
} from "@/components/ui/touchTarget";
import { cn } from "@/lib/utils";
import type {
  OnboardingTask,
  OnboardingTaskId,
} from "@/lib/onboarding";
import { GuideComplete } from "./GuideComplete";
import { minutesLeft } from "./guideMeta";
import { GuideTaskList } from "./GuideTaskList";
import { GuideWelcome } from "./GuideWelcome";

export type GuidePanelView = "welcome" | "checklist";

const PANEL_SAFE_AREA_STYLE = {
  paddingBottom: "env(safe-area-inset-bottom)",
  paddingLeft: "env(safe-area-inset-left)",
  paddingRight: "env(safe-area-inset-right)",
};

type GuidePanelProps = {
  open: boolean;
  view: GuidePanelView;
  journey: GuideJourneyState;
  activeTaskId: OnboardingTaskId | null;
  onClose: () => void;
  onDismiss: () => void;
  onStart: () => void;
  onNavigate: (task: OnboardingTask) => void;
};

function PanelCloseButton({ onClose }: { onClose: () => void }) {
  const t = useTranslations("guide");
  return (
    <button
      type="button"
      onClick={onClose}
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none",
        COARSE_POINTER_TARGET,
      )}
      aria-label={t("dismissPanel")}
    >
      <X className="h-4 w-4" aria-hidden />
    </button>
  );
}

function GuidePanelHeader({ onClose }: { onClose: () => void }) {
  const t = useTranslations("guide");
  return (
    <header className="relative overflow-hidden border-b border-border/60 px-5 pb-4 pt-4">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-emerald-50 via-transparent to-transparent dark:from-emerald-500/10"
      />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
            <Sparkles className="h-3 w-3" aria-hidden />
            {t("badge")}
          </div>
          <DialogPrimitive.Title asChild>
            <h2
              id="guide-panel-title"
              className="mt-1.5 text-base font-bold tracking-tight text-foreground"
            >
              {t("panelTitle")}
            </h2>
          </DialogPrimitive.Title>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {t("panelSubtitle")}
          </p>
        </div>
        <PanelCloseButton onClose={onClose} />
      </div>
    </header>
  );
}

function GuideProgress({ journey }: { journey: GuideJourneyState }) {
  const t = useTranslations("guide");
  const progress = journey.totalCount
    ? (journey.completedCount / journey.totalCount) * 100
    : 0;
  const remainingMinutes = minutesLeft(journey.checklist);
  return (
    <div className="flex items-center gap-3 px-5 pt-3.5">
      <div className="relative flex h-11 w-11 shrink-0 items-center justify-center text-emerald-500">
        <svg className="absolute h-11 w-11 -rotate-90" viewBox="0 0 44 44" aria-hidden>
          <circle cx="22" cy="22" r="18" fill="none" stroke="currentColor" strokeOpacity="0.12" strokeWidth="4" />
          <circle cx="22" cy="22" r="18" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeDasharray={`${progress * 1.13097} 113.097`} className="transition-[stroke-dasharray] duration-500 ease-out motion-reduce:transition-none" />
        </svg>
        <span className="text-[11px] font-bold text-foreground">{Math.round(progress)}%</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={t("panelTitle")} aria-valuenow={journey.completedCount} aria-valuemin={0} aria-valuemax={journey.totalCount}>
          <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-[width] duration-500 ease-out motion-reduce:transition-none" style={{ width: `${progress}%` }} />
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">{journey.completedCount} / {journey.totalCount}</span>
          {remainingMinutes > 0 ? (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" aria-hidden />
              {t("timeLeft", { min: remainingMinutes })}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function GuidePanelFooter() {
  const t = useTranslations("guide");
  return (
    <footer className="border-t border-border/60 px-5 py-3 text-[11px] text-muted-foreground">
      {t("openPanelHint", { kbd: "?" }).split("?").map((part, index, parts) => (
        <span key={`${part}-${index}`}>
          {part}
          {index < parts.length - 1 ? (
            <kbd className="mx-0.5 inline-flex h-5 min-w-[20px] items-center justify-center rounded border border-border bg-muted px-1 font-mono font-medium text-foreground/80">
              ?
            </kbd>
          ) : null}
        </span>
      ))}
    </footer>
  );
}

function ChecklistView({
  journey,
  activeTaskId,
  onClose,
  onNavigate,
}: Pick<
  GuidePanelProps,
  "journey" | "activeTaskId" | "onClose" | "onNavigate"
>) {
  return (
    <>
      <GuidePanelHeader onClose={onClose} />
      <GuideProgress journey={journey} />
      <GuideTaskList
        checklist={journey.checklist}
        activeTaskId={activeTaskId}
        onNavigate={onNavigate}
      />
      <GuidePanelFooter />
    </>
  );
}

function AccessiblePanelTitle({ children }: { children: ReactNode }) {
  return (
    <DialogPrimitive.Title asChild>
      <h2 id="guide-panel-title" className="sr-only">
        {children}
      </h2>
    </DialogPrimitive.Title>
  );
}

function GuidePanelBody(props: GuidePanelProps) {
  const t = useTranslations("guide");
  if (props.view === "welcome" && !props.journey.isComplete) {
    return (
      <>
        <div className="absolute right-3 top-3 z-10">
          <PanelCloseButton onClose={props.onClose} />
        </div>
        <AccessiblePanelTitle>{t("welcomeTitle")}</AccessiblePanelTitle>
        <GuideWelcome onStart={props.onStart} onSkip={props.onDismiss} />
      </>
    );
  }
  if (props.journey.isComplete) {
    return (
      <>
        <div className="absolute right-3 top-3 z-10">
          <PanelCloseButton onClose={props.onClose} />
        </div>
        <AccessiblePanelTitle>{t("allDone")}</AccessiblePanelTitle>
        <GuideComplete onDismiss={props.onDismiss} />
      </>
    );
  }
  return <ChecklistView {...props} />;
}

export function GuidePanel(props: GuidePanelProps) {
  const returnFocusRef = useRef<HTMLElement | null>(null);
  return (
    <DialogPrimitive.Root
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay asChild>
          <div
            data-testid="guide-modal-backdrop"
            className="fixed inset-0 z-[60] bg-foreground/40 backdrop-blur-sm guide-fade-in motion-reduce:animate-none"
            aria-hidden
          />
        </DialogPrimitive.Overlay>
        <DialogPrimitive.Content
          asChild
          aria-describedby={undefined}
          onOpenAutoFocus={() => {
            returnFocusRef.current =
              document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const target = returnFocusRef.current;
            returnFocusRef.current = null;
            if (target?.isConnected) target.focus({ preventScroll: true });
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="guide-panel-title"
            data-testid="guide-quickstart-panel"
            tabIndex={-1}
            className="fixed inset-x-0 bottom-0 z-[61] flex max-h-[85dvh] flex-col overflow-hidden rounded-t-2xl border border-border bg-card text-card-foreground shadow-[0_24px_60px_-30px_rgba(15,23,42,0.45)] guide-scale-in motion-reduce:animate-none md:bottom-5 md:left-auto md:right-5 md:top-auto md:max-h-[min(640px,calc(100dvh-2.5rem))] md:w-[380px] md:rounded-2xl focus:outline-none"
            style={PANEL_SAFE_AREA_STYLE}
          >
            <GuidePanelBody {...props} />
          </section>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
