"use client";

import { AlertCircle, FileText, Loader2, Square, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { BatchProgressState } from "../hooks/useBatchProgress";

export function BatchDetailsDialog({
  open,
  onOpenChange,
  state,
  actionPending,
  onCancel,
  onRetryFailed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: BatchProgressState;
  actionPending: boolean;
  onCancel: () => void;
  onRetryFailed: () => void;
}) {
  const t = useTranslations("jobs.batchDetails");
  const progress = state.total > 0 ? Math.min(1, state.done / state.total) : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="batch-details-dialog"
        className="bottom-0 left-0 top-auto max-h-[88dvh] max-w-none translate-x-0 translate-y-0 gap-0 overflow-y-auto rounded-b-none rounded-t-2xl p-0 sm:left-1/2 sm:top-1/2 sm:max-w-xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl lg:bottom-auto lg:left-auto lg:right-0 lg:top-0 lg:h-dvh lg:max-h-none lg:w-[26rem] lg:max-w-[calc(100vw-2rem)] lg:translate-x-0 lg:translate-y-0 lg:rounded-none lg:border-y-0 lg:border-r-0"
      >
        <DialogHeader className="border-b border-border/70 px-5 py-5 pr-14 text-left">
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {state.status ? t(`status.${state.status}`) : t("status.QUEUED")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 p-5">
          <section aria-labelledby="batch-summary-title" className="space-y-3">
            <h3 id="batch-summary-title" className="text-sm font-semibold">
              {t("summary")}
            </h3>
            <div className="grid grid-cols-3 gap-2 text-center">
              <Count label={t("generated")} value={state.succeeded} />
              <Count label={t("failed")} value={state.failed} />
              <Count label={t("skipped")} value={state.skipped} />
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
              className="h-2 overflow-hidden rounded-full bg-muted"
            >
              <div
                aria-hidden
                className="h-full origin-left rounded-full bg-brand-emerald-700 transition-transform duration-200 motion-reduce:transition-none"
                style={{ transform: `scaleX(${progress})` }}
              />
            </div>
            {state.pollUnavailable ? (
              <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-2.5 text-xs leading-relaxed text-amber-950 dark:bg-amber-500/10 dark:text-amber-100">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                {t("statusUnavailable")}
              </p>
            ) : null}
          </section>

          {state.failedItems.length > 0 ? (
            <section aria-labelledby="batch-failed-title" className="space-y-2">
              <h3 id="batch-failed-title" className="text-sm font-semibold">
                {t("needsAttention", { count: state.failedItems.length })}
              </h3>
              <ul className="space-y-2">
                {state.failedItems.map((item) => (
                  <li key={item.taskId} className="rounded-xl border border-destructive/20 bg-destructive/5 p-3">
                    <div className="flex items-start gap-2">
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
                      <div className="min-w-0">
                        <p className="font-medium text-foreground">{item.jobTitle}</p>
                        {item.company ? (
                          <p className="text-xs text-muted-foreground">{item.company}</p>
                        ) : null}
                        <p className="mt-1 break-words text-xs leading-relaxed text-destructive">
                          {item.error}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {state.succeededItems.length > 0 ? (
            <section aria-labelledby="batch-ready-title" className="space-y-2">
              <h3 id="batch-ready-title" className="text-sm font-semibold">
                {t("ready", { count: state.succeededItems.length })}
              </h3>
              <ul className="space-y-2">
                {state.succeededItems.map((item) => (
                  <li key={item.taskId} className="rounded-xl border border-border/70 p-3">
                    <div className="flex items-start gap-2">
                      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-brand-emerald-text" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-foreground">{item.jobTitle}</p>
                        {item.company ? (
                          <p className="text-xs text-muted-foreground">{item.company}</p>
                        ) : null}
                        <div className="mt-2 flex flex-wrap gap-2">
                          {item.artifacts.resumePdfUrl ? (
                            <ArtifactLink href={item.artifacts.resumePdfUrl}>
                              {t("reviewCv")}
                            </ArtifactLink>
                          ) : null}
                          {item.artifacts.coverPdfUrl ? (
                            <ArtifactLink href={item.artifacts.coverPdfUrl}>
                              {t("reviewCover")}
                            </ArtifactLink>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <div className="sticky bottom-0 flex flex-col-reverse gap-2 border-t border-border/70 bg-background/95 p-4 backdrop-blur sm:flex-row sm:justify-end">
          {state.active ? (
            <Button
              type="button"
              variant="outline"
              size="touch"
              disabled={actionPending}
              aria-busy={actionPending}
              onClick={onCancel}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              {actionPending ? (
                <Loader2 className="motion-safe:animate-spin" aria-hidden />
              ) : (
                <Square aria-hidden />
              )}
              {t("stopRemaining")}
            </Button>
          ) : state.failed > 0 ? (
            <Button
              type="button"
              size="touch"
              disabled={actionPending}
              aria-busy={actionPending}
              onClick={onRetryFailed}
              className="bg-brand-emerald-700 text-white hover:bg-brand-emerald-800"
            >
              {actionPending ? (
                <Loader2 className="motion-safe:animate-spin" aria-hidden />
              ) : null}
              {t("retryFailed", { count: state.failed })}
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-muted/60 px-2 py-2.5">
      <p className="text-lg font-bold tabular-nums text-foreground">{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

function ArtifactLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-11 items-center rounded-lg border border-border/70 px-3 text-xs font-semibold text-brand-emerald-text transition-colors hover:bg-brand-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600 dark:hover:bg-brand-emerald-500/10"
    >
      {children}
    </a>
  );
}
