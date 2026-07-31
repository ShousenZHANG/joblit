"use client";

import React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Loader2,
  Minus,
  X,
  XCircle,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  FetchRunLane,
  FetchRunStatus,
} from "@/app/FetchStatusContext";
import {
  fetchSourceLabel,
  type FetchProgressModel,
} from "./useFetchProgressModel";
const MOTION_EASE = [0.16, 1, 0.3, 1] as const;
const SPRING = {
  type: "spring" as const,
  stiffness: 320,
  damping: 28,
  mass: 0.6,
};

export type FetchProgressFabProps = Pick<
  FetchProgressModel,
  "isRunning" | "progressValue" | "progressValueText"
> & {
  status: FetchRunStatus | null;
  importedCount: number;
  reducedMotion: boolean | null;
  setFabRef: (node: HTMLButtonElement | null) => void;
  onOpen: () => void;
};

function fabGlyph(
  status: FetchRunStatus | null,
  importedCount: number,
): string | number {
  if (status === "SUCCEEDED") return "\u2713";
  if (status === "PARTIAL") return "!";
  if (status === "FAILED") return "\u2715";
  return importedCount > 0 ? importedCount : "\u22ef";
}

function ProgressRing({
  status,
  progressValue,
  reducedMotion,
}: {
  status: FetchRunStatus | null;
  progressValue: number;
  reducedMotion: boolean | null;
}) {
  const circumference = 2 * Math.PI * 22;
  const strokeDashoffset =
    circumference - (progressValue / 100) * circumference;
  const stroke =
    status === "FAILED"
      ? "var(--color-destructive, #ef4444)"
      : status === "PARTIAL"
        ? "var(--color-tier-fair-fg, #d97706)"
        : "var(--color-brand-emerald-500, #10b981)";
  return (
    <svg className="h-11 w-11 -rotate-90" viewBox="0 0 48 48">
      <circle
        cx="24"
        cy="24"
        r="22"
        fill="none"
        stroke="var(--color-muted, #e2e8f0)"
        strokeWidth="3"
      />
      <motion.circle
        cx="24"
        cy="24"
        r="22"
        fill="none"
        stroke={stroke}
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={circumference}
        animate={{ strokeDashoffset }}
        transition={
          reducedMotion
            ? { duration: 0 }
            : { duration: 0.26, ease: MOTION_EASE }
        }
      />
    </svg>
  );
}

export function FetchProgressFab(props: FetchProgressFabProps) {
  const t = useTranslations("fetchProgress");
  const {
    status,
    importedCount,
    isRunning,
    progressValue,
    progressValueText,
    reducedMotion,
    setFabRef,
    onOpen,
  } = props;
  const glyph = fabGlyph(status, importedCount);
  return (
    <motion.button
      ref={setFabRef}
      key="fab"
      type="button"
      initial={reducedMotion ? false : { opacity: 0, scale: 0.85, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={reducedMotion ? undefined : { opacity: 0, scale: 0.85, y: 12 }}
      transition={reducedMotion ? { duration: 0 } : SPRING}
      onClick={onOpen}
      aria-label={`${t("openAria")}: ${progressValueText}`}
      className="fixed bottom-6 right-6 z-50 flex h-14 w-14 touch-manipulation items-center justify-center rounded-full border border-border/60 bg-background/95 shadow-lg backdrop-blur motion-safe:transition-shadow hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-500"
    >
      <ProgressRing
        status={status}
        progressValue={progressValue}
        reducedMotion={reducedMotion}
      />
      <span
        key={status}
        className={cn(
          "absolute text-[11px] font-bold tabular-nums text-foreground",
          status === "SUCCEEDED" && !reducedMotion && "cosmos-burst",
        )}
      >
        {glyph}
      </span>
      {isRunning ? (
        <span className="pointer-events-none absolute inset-0 rounded-full border-2 border-brand-emerald-400 opacity-20 motion-safe:animate-ping" />
      ) : null}
    </motion.button>
  );
}

export type FetchProgressDialogProps = FetchProgressModel & {
  status: FetchRunStatus | null;
  importedCount: number;
  error: string | null;
  queryTitle: string | null;
  queryTerms: string[];
  smartExpand: boolean;
  elapsedSeconds: number;
  lanes: FetchRunLane[];
  cancelling: boolean;
  cancelError: string | null;
  reducedMotion: boolean | null;
  onMinimize: () => void;
  onCancel: () => Promise<void>;
};

function StatusIcon({
  status,
  isRunning,
}: {
  status: FetchRunStatus | null;
  isRunning: boolean;
}) {
  if (isRunning) {
    return (
      <Loader2
        className="h-4 w-4 shrink-0 text-brand-emerald-600 motion-safe:animate-spin"
        aria-hidden
      />
    );
  }
  if (status === "SUCCEEDED") {
    return (
      <CheckCircle2
        className="h-4 w-4 shrink-0 text-brand-emerald-600"
        aria-hidden
      />
    );
  }
  return status === "PARTIAL" ? (
    <AlertTriangle
      className="h-4 w-4 shrink-0 text-[theme(colors.tier-fair-fg)]"
      aria-hidden
    />
  ) : null;
}

function PanelHeader(props: FetchProgressDialogProps) {
  const t = useTranslations("fetchProgress");
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border/50 px-4 py-3">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <StatusIcon status={props.status} isRunning={props.isRunning} />
        <div className="truncate text-sm font-semibold text-foreground">
          {t("title")}
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            props.statusTone,
          )}
        >
          {props.statusLabel}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <HeaderButton label={t("minimize")} onClick={props.onMinimize}>
          <Minus className="h-4 w-4" aria-hidden />
        </HeaderButton>
        {!props.isRunning ? (
          <HeaderButton label={t("close")} onClick={props.onMinimize} close>
            <X className="h-4 w-4" aria-hidden />
          </HeaderButton>
        ) : null}
      </div>
    </div>
  );
}

function HeaderButton({
  label,
  onClick,
  close = false,
  children,
}: {
  label: string;
  onClick: () => void;
  close?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-11 w-11 touch-manipulation items-center justify-center rounded-xl text-muted-foreground motion-safe:transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2",
        close
          ? "focus-visible:ring-destructive"
          : "focus-visible:ring-brand-emerald-500",
      )}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

function StatusSummary(props: FetchProgressDialogProps) {
  const t = useTranslations("fetchProgress");
  const line =
    props.status === "RUNNING"
      ? t("lineRunning")
      : props.status === "SUCCEEDED"
        ? t("lineCompleted")
        : props.status === "PARTIAL"
          ? t("linePartial")
          : props.status === "FAILED"
            ? t("lineFailed")
            : t("lineQueued");
  return (
    <>
      <div className="text-xs text-muted-foreground">{line}</div>
      {props.isRunning && props.importedCount > 0 ? (
        <div className="text-sm font-semibold text-brand-emerald-text">
          {t("importedSoFar", { n: props.importedCount })}
        </div>
      ) : null}
    </>
  );
}

function QuerySummary(props: FetchProgressDialogProps) {
  const t = useTranslations("fetchProgress");
  if (!props.queryTerms.length) return null;
  const shown = props.queryTerms.slice(0, 6);
  const hidden = Math.max(0, props.queryTerms.length - shown.length);
  return (
    <div className="rounded-xl border border-border/60 bg-muted/40 p-3">
      <div className="text-[11px] text-muted-foreground">
        {props.smartExpand && props.queryTitle
          ? t("smartExpanded", {
              title: props.queryTitle,
              n: props.queryTerms.length,
            })
          : t("roleQueries", { n: props.queryTerms.length })}
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {shown.map((term) => (
          <span
            key={term}
            className="rounded-full border border-border bg-background px-2 py-0.5 text-[11px] text-foreground/85"
          >
            {term}
          </span>
        ))}
        {hidden ? (
          <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground">
            {t("moreTerms", { n: hidden })}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function ProgressMeter(props: FetchProgressDialogProps) {
  const t = useTranslations("fetchProgress");
  const barLabel =
    props.status === "SUCCEEDED"
      ? t("barDone")
      : props.status === "PARTIAL"
        ? t("barPartial")
        : props.status === "FAILED"
          ? t("barStopped")
          : props.isRunning && props.importedCount > 0
            ? t("barImported", { n: props.importedCount })
            : t("barWorking");
  return (
    <div className="space-y-1.5">
      <div
        role="progressbar"
        aria-label={t("title")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={
          props.isIndeterminate ? undefined : props.progressValue
        }
        aria-valuetext={props.progressValueText}
        className="h-2 overflow-hidden rounded-full bg-brand-emerald-100/60"
      >
        <div
          data-testid="fetch-progress-fill"
          className={cn(
            "h-full w-full origin-left bg-gradient-to-r from-brand-emerald-500 to-brand-emerald-600 shadow-[0_0_10px_rgba(16,185,129,0.4)] motion-safe:transition-transform motion-safe:duration-[260ms] motion-safe:ease-[cubic-bezier(0.16,1,0.3,1)]",
            props.status === "FAILED" &&
              "from-destructive to-destructive bg-destructive",
            props.status === "PARTIAL" &&
              "bg-[theme(colors.tier-fair-fg)] [background-image:none] shadow-none",
          )}
          style={{ transform: `scaleX(${props.progressValue / 100})` }}
        />
      </div>
      <div className="flex items-center justify-between text-[11px] text-muted-foreground tabular-nums">
        <span className="font-medium text-foreground/80">{barLabel}</span>
        <span>{t("elapsed", { n: props.elapsedSeconds })}</span>
      </div>
    </div>
  );
}

function ResultWithJobs(props: FetchProgressDialogProps) {
  const t = useTranslations("fetchProgress");
  return (
    <>
      <div
        className={cn(
          "relative overflow-hidden rounded-lg py-3 text-center",
          props.isPartial
            ? "border border-[var(--tier-fair-ring)] bg-[theme(colors.tier-fair-bg)]"
            : "bg-brand-emerald-50/60",
        )}
      >
        {props.isPartial || props.reducedMotion ? null : <ConfettiDots />}
        <div
          className={cn(
            "text-sm font-semibold",
            props.isPartial
              ? "text-[theme(colors.tier-fair-fg)]"
              : "text-brand-emerald-text",
          )}
        >
          {t("importedNew", { n: props.importedCount })}
        </div>
        {props.isPartial ? (
          <div className="mt-1 text-xs font-medium text-muted-foreground">
            {t("partialNote", {
              sources: props.incompleteSources.join(", "),
            })}
          </div>
        ) : null}
      </div>
      <Button
        size="touch"
        className="w-full rounded-full bg-brand-emerald-600 text-[13px] font-semibold text-white shadow-sm hover:bg-brand-emerald-700"
        onClick={props.onMinimize}
        asChild
      >
        <Link href="/jobs">{t("viewJobs")}</Link>
      </Button>
    </>
  );
}

function EmptyResult(props: FetchProgressDialogProps) {
  const t = useTranslations("fetchProgress");
  return (
    <>
      <div className="rounded-lg border border-border/60 bg-muted/40 px-3 py-3 text-center">
        <div className="text-sm font-semibold text-foreground">
          {props.isPartial ? t("partialNoNew") : t("noNew")}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {props.isPartial
            ? t("partialNote", {
                sources: props.incompleteSources.join(", "),
              })
            : t("noNewHint")}
        </div>
      </div>
      <Button
        variant="outline"
        size="touch"
        className="w-full rounded-full text-[13px] font-semibold"
        onClick={props.onMinimize}
      >
        {t("dismiss")}
      </Button>
    </>
  );
}

function TerminalResult(props: FetchProgressDialogProps) {
  if (props.status !== "SUCCEEDED" && !props.isPartial) return null;
  return props.importedCount > 0 ? (
    <ResultWithJobs {...props} />
  ) : (
    <EmptyResult {...props} />
  );
}

function userFacingFetchError(
  error: string,
  timeoutHint: string,
): string {
  if (/FETCH_TIMEOUT/.test(error)) return timeoutHint;
  if (/(challenge|cloudflare|status=403|status=429)/i.test(error)) {
    return "The job source is rate-limiting us right now \u2014 wait a moment and try again, or switch source.";
  }
  if (/(request failed|timeout|connectionpool|unreachable)/i.test(error)) {
    return "Couldn't reach the job source. Please retry shortly.";
  }
  return error;
}

function FetchErrorAlert(props: FetchProgressDialogProps) {
  const t = useTranslations("fetchProgress");
  if (!props.error) return null;
  return (
    <div
      role="alert"
      className={cn(
        "rounded-lg border px-3 py-2 text-sm",
        props.isPartial
          ? "border-[var(--tier-fair-ring)] bg-[theme(colors.tier-fair-bg)] text-[theme(colors.tier-fair-fg)]"
          : "border-destructive/30 bg-destructive/10 text-destructive",
      )}
    >
      {userFacingFetchError(props.error, t("timeoutHint"))}
    </div>
  );
}

function CancellationActions(props: FetchProgressDialogProps) {
  const t = useTranslations("fetchProgress");
  return (
    <>
      {props.cancelError ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {t("cancelFailed")}
        </div>
      ) : null}
      {props.isRunning ? (
        <Button
          variant="outline"
          size="touch"
          className="w-full rounded-full border-destructive/30 bg-destructive/5 text-[13px] font-semibold text-destructive shadow-sm motion-safe:transition-colors hover:border-destructive/50 hover:bg-destructive/15 hover:text-destructive"
          onClick={props.onCancel}
          disabled={props.cancelling}
          aria-busy={props.cancelling}
        >
          {props.cancelling ? (
            <Loader2
              className="motion-safe:animate-spin"
              aria-hidden="true"
            />
          ) : null}
          {props.cancelling ? t("cancelling") : t("cancel")}
        </Button>
      ) : null}
    </>
  );
}

function PanelBody(props: FetchProgressDialogProps) {
  return (
    <div className="space-y-3 px-4 py-4">
      <StepIndicator
        status={props.status}
        reducedMotion={props.reducedMotion}
      />
      {props.lanes.length > 1 ? <SourceLanes lanes={props.lanes} /> : null}
      <StatusSummary {...props} />
      <QuerySummary {...props} />
      <ProgressMeter {...props} />
      <TerminalResult {...props} />
      <FetchErrorAlert {...props} />
      <CancellationActions {...props} />
    </div>
  );
}

export function FetchProgressDialog(props: FetchProgressDialogProps) {
  const t = useTranslations("fetchProgress");
  return (
    <motion.div
      key="panel"
      role="dialog"
      aria-label={t("title")}
      data-testid="fetch-progress-panel"
      initial={
        props.reducedMotion ? false : { opacity: 0, scale: 0.94, y: 16 }
      }
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={
        props.reducedMotion
          ? undefined
          : { opacity: 0, scale: 0.94, y: 16 }
      }
      transition={props.reducedMotion ? { duration: 0 } : SPRING}
      className={cn(
        "fixed bottom-6 right-6 z-50 w-[380px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-3xl border border-border/60 bg-background/95 shadow-[0_28px_60px_-24px_rgba(15,23,42,0.22)] backdrop-blur-xl",
        props.isRunning && !props.reducedMotion && "cosmos-scan",
      )}
    >
      <PanelHeader {...props} />
      <PanelBody {...props} />
    </motion.div>
  );
}

type Step = { label: string; done: boolean; active: boolean };

function StepGlyph({
  done,
  partialDone,
  index,
}: {
  done: boolean;
  partialDone: boolean;
  index: number;
}) {
  if (!done) return index + 1;
  return partialDone ? (
    <AlertTriangle className="h-3 w-3" strokeWidth={3} aria-hidden />
  ) : (
    <ChevronDown
      className="h-3 w-3 rotate-[-135deg]"
      strokeWidth={3}
      aria-hidden
    />
  );
}

function StepNode({
  step,
  index,
  last,
  status,
  reducedMotion,
}: {
  step: Step;
  index: number;
  last: boolean;
  status: FetchRunStatus | null;
  reducedMotion: boolean | null;
}) {
  const partialDone = status === "PARTIAL" && last;
  return (
    <>
      <div className="flex min-w-0 flex-col items-center gap-1">
        <div
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold motion-safe:transition-colors",
            step.active && "motion-safe:animate-pulse",
            step.done
              ? partialDone
                ? "bg-[theme(colors.tier-fair-fg)] text-white"
                : "bg-brand-emerald-500 text-white"
              : step.active
                ? "bg-[theme(colors.tier-good-fg)] text-white"
                : "bg-muted text-muted-foreground",
          )}
        >
          <StepGlyph
            done={step.done}
            partialDone={partialDone}
            index={index}
          />
        </div>
        <span className="text-[10px] font-medium text-muted-foreground">
          {step.label}
        </span>
      </div>
      {!last ? <StepConnector done={step.done} reducedMotion={reducedMotion} /> : null}
    </>
  );
}

function StepConnector({
  done,
  reducedMotion,
}: {
  done: boolean;
  reducedMotion: boolean | null;
}) {
  return (
    <div className="relative mb-4 h-0.5 flex-1 overflow-hidden rounded-full bg-muted">
      <motion.div
        initial={false}
        animate={{ scaleX: done ? 1 : 0 }}
        transition={
          reducedMotion
            ? { duration: 0 }
            : { duration: 0.26, ease: MOTION_EASE }
        }
        className="absolute inset-y-0 left-0 w-full origin-left bg-brand-emerald-500"
      />
    </div>
  );
}

function StepIndicator({
  status,
  reducedMotion,
}: {
  status: FetchRunStatus | null;
  reducedMotion: boolean | null;
}) {
  const t = useTranslations("fetchProgress");
  const terminal =
    status === "SUCCEEDED" || status === "PARTIAL" || status === "FAILED";
  const steps: Step[] = [
    { label: t("stepQueued"), done: status !== "QUEUED", active: status === "QUEUED" },
    { label: t("stepFetching"), done: terminal, active: status === "RUNNING" },
    {
      label: t("stepDone"),
      done: status === "SUCCEEDED" || status === "PARTIAL",
      active: false,
    },
  ];
  return (
    <div className="flex items-center gap-1">
      {steps.map((step, index) => (
        <StepNode
          key={step.label}
          step={step}
          index={index}
          last={index === steps.length - 1}
          status={status}
          reducedMotion={reducedMotion}
        />
      ))}
    </div>
  );
}

function SourceLaneItem({ lane }: { lane: FetchRunLane }) {
  const t = useTranslations("fetchProgress");
  const active = lane.status === "RUNNING" || lane.status === "QUEUED";
  const label =
    lane.status === "RUNNING"
      ? t("statusRunning")
      : lane.status === "QUEUED"
        ? t("statusQueued")
        : lane.status === "SUCCEEDED"
          ? t("statusCompleted")
          : lane.status === "PARTIAL"
            ? t("statusPartial")
            : t("statusFailed");
  const icon = active ? (
    <Loader2 className="h-3.5 w-3.5 shrink-0 text-brand-emerald-600 motion-safe:animate-spin" aria-hidden />
  ) : lane.status === "SUCCEEDED" ? (
    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-brand-emerald-600" aria-hidden />
  ) : lane.status === "PARTIAL" ? (
    <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-[theme(colors.tier-fair-fg)]" aria-hidden />
  ) : (
    <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden />
  );
  return (
    <li className="flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-muted/30 px-2.5 py-1.5">
      <div className="flex min-w-0 items-center gap-2">
        {icon}
        <span className="truncate text-xs font-semibold text-foreground">
          {fetchSourceLabel(lane.source)}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {lane.importedCount > 0 ? (
          <span className="text-[11px] font-semibold tabular-nums text-brand-emerald-text">
            +{lane.importedCount}
          </span>
        ) : null}
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
      </div>
    </li>
  );
}

function SourceLanes({ lanes }: { lanes: FetchRunLane[] }) {
  return (
    <ul className="space-y-1.5" aria-label="Sources">
      {lanes.map((lane) => (
        <SourceLaneItem key={lane.id} lane={lane} />
      ))}
    </ul>
  );
}

function ConfettiDots() {
  const dots = [
    { color: "bg-brand-emerald-400", x: -30, delay: "0ms" },
    { color: "bg-[theme(colors.tier-good-fg)]", x: 20, delay: "100ms" },
    { color: "bg-[theme(colors.tier-fair-fg)]", x: -15, delay: "200ms" },
    { color: "bg-destructive", x: 35, delay: "50ms" },
    { color: "bg-brand-emerald-300", x: 10, delay: "250ms" },
    { color: "bg-brand-emerald-500", x: -40, delay: "150ms" },
  ];
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center">
      {dots.map((dot, index) => (
        <span
          key={index}
          className={`absolute h-1.5 w-1.5 rounded-full ${dot.color} animate-confetti-pop`}
          style={
            {
              "--confetti-x": `${dot.x}px`,
              animationDelay: dot.delay,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
