"use client";

import { useTranslations } from "next-intl";
import { Check, FileText, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TailorTarget } from "./tailorActions";
import type { LocalTailorCompanion } from "./useLocalTailorCompanion";

interface TailorGeneratePanelProps {
  target: TailorTarget;
  hasContent: boolean;
  disabled: boolean;
  companion: LocalTailorCompanion;
}

export function TailorGeneratePanel({ target, hasContent, disabled, companion }: TailorGeneratePanelProps) {
  const t = useTranslations("tailor.dialog");
  const tc = useTranslations("tailor.companion");
  const { task, taskError, generating, restoring, starting, cancelling, connection, dispatchPending } = companion;
  const status = starting ? "queued" : task?.status;
  const activeStage = status === "publishing" ? 1 : 0;
  const stages = ["contentStage", "pdfStage"] as const;
  const error = task?.error?.message ?? (task?.status === "failed" ? tc("task.failed") : null);
  const action = <Button type="button" disabled={generating || restoring || disabled || connection !== "ready"} onClick={() => void companion.generate()}
    data-guide-anchor={target === "resume" ? "generate_first_pdf" : undefined}
    className="min-h-11 w-full rounded-xl bg-brand-emerald-600 px-5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-emerald-700 disabled:bg-muted disabled:text-muted-foreground sm:w-auto motion-reduce:transition-none">
    {generating || restoring ? <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
    {generating ? t("generateRunning") : restoring ? tc("restoring") : dispatchPending ? tc("resumeGeneration") : t("generateLocally")}
  </Button>;

  return <section aria-label={t("generateLocally")} className="mb-4 overflow-hidden rounded-2xl border border-brand-emerald-500/25 bg-gradient-to-br from-brand-emerald-500/5 via-background to-background">
    {hasContent && !generating && !dispatchPending && !taskError && !error ? <details className="group px-4 py-3">
      <summary className="cursor-pointer rounded-lg py-2 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">{t("regenerateTitle")}</summary>
      <p className="mb-3 mt-1 text-sm leading-relaxed text-muted-foreground">{t("regenerateBody")}</p>{action}
    </details> : <div className="p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span aria-hidden className="hidden size-10 shrink-0 items-center justify-center rounded-xl border border-brand-emerald-500/20 bg-background text-brand-emerald-600 sm:flex"><FileText className="size-5" /></span>
        <div className="min-w-0"><h3 className="text-base font-semibold tracking-tight">{t(target === "resume" ? "resumeReadyTitle" : "coverReadyTitle")}</h3>
          <p className="mt-1 max-w-prose text-sm leading-relaxed text-muted-foreground">{t(target === "resume" ? "resumeReadyBody" : "coverReadyBody")}</p></div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">{action}<p className="text-xs leading-relaxed text-muted-foreground">{connection === "ready" ? tc("readyHint") : tc("connectFirst")}</p></div>
    </div>}

    {generating || dispatchPending ? <div className="border-t border-brand-emerald-500/20 bg-background/60 px-4 py-4 sm:px-5">
      {status !== "cancelling" && !dispatchPending ? <ol className="grid grid-cols-2 gap-2" aria-label={t("progressLabel")}>
        {stages.map((item, index) => <li key={item} aria-current={index === activeStage ? "step" : undefined} className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span className={`flex size-6 shrink-0 items-center justify-center rounded-full ${index <= activeStage ? "bg-brand-emerald-600 text-white" : "bg-muted text-muted-foreground"}`}>{index < activeStage ? <Check className="size-3.5" aria-hidden /> : index + 1}</span><span>{tc(item)}</span>
        </li>)}
      </ol> : null}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div><p role="status" aria-live="polite" className="text-sm font-medium">{dispatchPending ? tc("dispatchPendingTitle") : tc(`task.${status ?? "queued"}`)}{task && task.attempt > 0 && status !== "publishing" ? ` · ${tc("attempt", { attempt: task.attempt, total: task.maxAttempts })}` : ""}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{tc(dispatchPending ? "dispatchPendingHint" : "closeSafe")}</p></div>
        <Button type="button" size="sm" variant="outline" className="min-h-10 [@media(pointer:coarse)]:min-h-11 rounded-lg text-xs" disabled={starting || cancelling} onClick={() => void companion.cancel()}>{cancelling ? <Loader2 className="size-3.5 motion-safe:animate-spin" aria-hidden /> : null}{tc(cancelling ? "cancelling" : "cancel")}</Button>
      </div>
    </div> : task && (["cancelled", "expired"].includes(task.status) || (task.status === "completed" && !hasContent)) ? <p role="status" className="border-t border-border/50 px-4 py-3 text-xs text-muted-foreground">{tc(`task.${task.status}`)}</p> : null}

    {taskError || error ? <div role="alert" className="m-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
      <p>{error ?? (taskError ? tc(`errors.${taskError.code}`) : "")}</p>
      {taskError?.code === "http" && !error ? <p className="mt-1">{taskError.message}</p> : null}
      {task && generating ? <p className="mt-1 text-xs leading-relaxed">{tc("unknownStart")}</p> : null}
      <Button type="button" variant="ghost" size="sm" className="mt-1 min-h-10 [@media(pointer:coarse)]:min-h-11 px-2 text-xs" onClick={() => void companion.refreshTask()}>{tc("refreshTask")}</Button>
    </div> : null}
  </section>;
}
