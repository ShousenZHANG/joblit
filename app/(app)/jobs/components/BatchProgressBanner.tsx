"use client";

import {
  AlertTriangle,
  CheckCircle2,
  CircleStop,
  Clock3,
  Loader2,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import type { BatchProgressState } from "../hooks/useBatchProgress";
import { cn } from "@/lib/utils";

type RunnerUiStatus = "online" | "offline" | "unknown" | "unavailable";

export function BatchProgressBanner({
  state,
  runnerStatus,
  onOpenSetup,
  onViewDetails,
  onDismiss,
}: {
  state: BatchProgressState;
  runnerStatus: RunnerUiStatus;
  onOpenSetup: () => void;
  onViewDetails: () => void;
  onDismiss: () => void;
}) {
  const t = useTranslations("jobs.batchProgress");
  const finished = !state.active;
  const waitingForRunner = state.status === "QUEUED" && runnerStatus === "offline";
  const hasIssues = state.failed > 0 || state.skipped > 0;
  const terminalIssue =
    state.status === "FAILED" ||
    state.status === "PARTIAL" ||
    (finished && hasIssues);
  const progress = state.total > 0 ? Math.min(1, state.done / state.total) : 0;

  const message =
    state.status === "CANCELLED"
      ? t("cancelled", {
          done: state.succeeded,
          total: state.total,
          skipped: state.skipped,
        })
      : state.status === "FAILED"
        ? t("failed", { done: state.succeeded, total: state.total })
        : state.status === "PARTIAL" || (finished && hasIssues)
          ? t("finishedWithFailures", {
              done: state.succeeded,
              total: state.total,
              failed: state.failed,
              skipped: state.skipped,
            })
          : state.status === "SUCCEEDED"
            ? t("finished", { total: state.total })
            : waitingForRunner
              ? t("waitingForRunner", { done: state.done, total: state.total })
              : state.status === "QUEUED"
                ? t("queued", { done: state.done, total: state.total })
                : t("generating", { done: state.done, total: state.total });

  return (
    <div
      data-testid="batch-progress-banner"
      className={cn(
        "border-b px-4 py-2.5 text-[13px]",
        waitingForRunner
          ? "bg-amber-50 text-amber-950 dark:bg-amber-500/10 dark:text-amber-100"
          : state.status === "CANCELLED" || state.status === "FAILED" || hasIssues
            ? "bg-background/80 text-foreground"
            : finished
              ? "bg-brand-emerald-50/70 text-brand-emerald-900 dark:bg-brand-emerald-500/10 dark:text-brand-emerald-100"
              : "bg-background/80 text-foreground",
      )}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-2.5 sm:items-center">
          {waitingForRunner ? (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 sm:mt-0" aria-hidden />
          ) : state.status === "CANCELLED" ? (
            <CircleStop className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground sm:mt-0" aria-hidden />
          ) : terminalIssue ? (
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 sm:mt-0 dark:text-amber-300"
              aria-hidden
            />
          ) : finished ? (
            <CheckCircle2
              className="mt-0.5 h-4 w-4 shrink-0 text-brand-emerald-text sm:mt-0 dark:text-brand-emerald-300"
              aria-hidden
            />
          ) : state.status === "QUEUED" ? (
            <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-brand-emerald-text sm:mt-0" aria-hidden />
          ) : (
            <Loader2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-emerald-text motion-safe:animate-spin sm:mt-0" aria-hidden />
          )}

          <div className="min-w-0 flex-1">
            <div role="status" aria-live="polite" aria-atomic="true">
              <p className="font-medium leading-5">{message}</p>
              {state.pollUnavailable ? (
                <p className="text-xs leading-4 text-muted-foreground">
                  {t("statusUnavailable")}
                </p>
              ) : null}
            </div>
            <div
              role="progressbar"
              aria-label={t("progressLabel")}
              aria-valuemin={0}
              aria-valuemax={state.total}
              aria-valuenow={state.done}
              aria-valuetext={t("progressValue", {
                done: state.done,
                total: state.total,
              })}
              className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-black/10 dark:bg-white/15"
            >
              <div
                aria-hidden
                className="h-full origin-left rounded-full bg-brand-emerald-700 transition-transform duration-200 motion-reduce:transition-none"
                style={{ transform: `scaleX(${progress})` }}
              />
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1 self-end sm:self-center">
          {waitingForRunner ? (
            <button
              type="button"
              onClick={onOpenSetup}
              className="inline-flex min-h-11 items-center rounded-lg px-3 text-xs font-semibold text-amber-950 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600 dark:text-amber-100"
            >
              {t("setUpRunner")}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onViewDetails}
            className="inline-flex min-h-11 items-center rounded-lg px-3 text-xs font-semibold text-foreground underline-offset-2 hover:bg-black/5 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600 dark:hover:bg-white/10"
          >
            {t("viewDetails")}
          </button>
          {finished ? (
            <button
              type="button"
              onClick={onDismiss}
              aria-label={t("dismiss")}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600 dark:hover:bg-white/10"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
