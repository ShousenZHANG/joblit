"use client";

import { AlertTriangle, CheckCircle2, Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { BatchProgressState } from "../hooks/useBatchProgress";
import { cn } from "@/lib/utils";

/**
 * What is happening right now, in one strip above the list.
 *
 * Before this, queueing a batch produced a toast and then silence: the work
 * happened in another process, on another machine, and the page had no idea.
 * The counts are the server's own, so the strip never invents a percentage —
 * it says "3 of 7" because three tasks have actually settled.
 *
 * Runner presence is shown here rather than as a standing chip: it is only
 * interesting while there is work waiting for it, and a batch that is queued
 * with nothing to run it is exactly the failure worth naming.
 */
export function BatchProgressBanner({
  state,
  runnerOnline,
  onOpenSetup,
  onDismiss,
}: {
  state: BatchProgressState;
  runnerOnline: boolean;
  onOpenSetup: () => void;
  onDismiss: () => void;
}) {
  const t = useTranslations("jobs.batchProgress");
  const finished = !state.active;
  const stalled = state.active && !runnerOnline;

  return (
    <div
      data-testid="batch-progress-banner"
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-center gap-2.5 border-b px-4 py-2 text-[13px]",
        stalled
          ? "bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"
          : finished && state.failed === 0
            ? "bg-brand-emerald-50/70 text-brand-emerald-900 dark:bg-brand-emerald-500/10 dark:text-brand-emerald-200"
            : "bg-background/70 text-foreground",
      )}
    >
      {stalled ? (
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
      ) : finished ? (
        <CheckCircle2
          className={cn(
            "h-4 w-4 shrink-0",
            state.failed === 0 ? "text-brand-emerald-600" : "text-amber-600",
          )}
          aria-hidden
        />
      ) : (
        <Loader2
          className="h-4 w-4 shrink-0 text-brand-emerald-600 motion-safe:animate-spin"
          aria-hidden
        />
      )}

      <span className="min-w-0 flex-1 truncate">
        {stalled
          ? t("waitingForRunner", { done: state.done, total: state.total })
          : finished
            ? state.failed > 0
              ? t("finishedWithFailures", {
                  done: state.done - state.failed,
                  total: state.total,
                  failed: state.failed,
                })
              : t("finished", { total: state.total })
            : t("generating", { done: state.done, total: state.total })}
      </span>

      {stalled ? (
        <button
          type="button"
          onClick={onOpenSetup}
          className="shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600"
        >
          {t("setUpRunner")}
        </button>
      ) : null}

      {finished ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t("dismiss")}
          className="shrink-0 rounded-md p-0.5 transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600 dark:hover:bg-white/10"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
