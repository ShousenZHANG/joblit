"use client";

import { useTranslations } from "next-intl";
import { Check, FileText, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TailorTarget } from "./tailorActions";

interface TailorGeneratePanelProps {
  target: TailorTarget;
  hasContent: boolean;
  disabled: boolean;
  stage: "generate" | "import" | "publish";
  onGenerate: () => void;
  generating: boolean;
  /** Live stage line while the chain runs; null when idle. */
  status: string | null;
  error: string | null;
  offline: boolean;
  /**
   * The last generated JSON, kept only when something downstream refused it.
   * There is no paste box to park it in any more, so the panel offers it back
   * rather than dropping work the model already did — retrying the import
   * first, because most refusals are transient and re-running the model costs
   * a minute and a slice of the operator's quota.
   */
  rescuableOutput: string | null;
  onRetryOutput: () => void;
  onCopyOutput: () => void;
  outputCopied: boolean;
}

/**
 * The tailoring entry point: one button that ends at a published PDF.
 *
 * It is a panel rather than an accordion step because it is the whole first
 * half of the flow — generation used to be a copy-prompt/paste-result pair of
 * steps, and a step that must be expanded to be seen is the wrong home for the
 * only action on the screen.
 */
export function TailorGeneratePanel({
  target,
  hasContent,
  disabled,
  stage,
  onGenerate,
  generating,
  status,
  error,
  offline,
  rescuableOutput,
  onRetryOutput,
  onCopyOutput,
  outputCopied,
}: TailorGeneratePanelProps) {
  const t = useTranslations("tailor.dialog");
  const stages = ["generate", "import", "publish"] as const;
  const activeStage = stages.indexOf(stage);
  const action = (
    <Button
      type="button"
      disabled={generating || disabled}
      onClick={onGenerate}
      data-guide-anchor={target === "resume" ? "generate_first_pdf" : undefined}
      className="min-h-11 w-full rounded-xl bg-brand-emerald-600 px-5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-emerald-700 disabled:bg-muted disabled:text-muted-foreground sm:w-auto motion-reduce:transition-none"
    >
      {generating ? <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
      {generating ? t("generateRunning") : t("generateLocally")}
    </Button>
  );
  return (
    <section aria-label={t("generateLocally")} className="mb-4 overflow-hidden rounded-2xl border border-brand-emerald-500/25 bg-gradient-to-br from-brand-emerald-500/5 via-background to-background">
      {hasContent && !generating && !error ? (
        <details className="group px-4 py-3">
          <summary className="cursor-pointer rounded-lg py-2 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">{t("regenerateTitle")}</summary>
          <p className="mb-3 mt-1 text-sm leading-relaxed text-muted-foreground">{t("regenerateBody")}</p>
          {action}
        </details>
      ) : (
        <div className="p-5 sm:p-6">
          <div className="flex items-start gap-4">
            <div aria-hidden className="hidden size-14 shrink-0 items-center justify-center rounded-2xl border border-brand-emerald-500/20 bg-background text-brand-emerald-600 shadow-sm sm:flex">
              <FileText className="size-7" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-lg font-semibold tracking-tight text-foreground">{t(target === "resume" ? "resumeReadyTitle" : "coverReadyTitle")}</h3>
              <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">{t(target === "resume" ? "resumeReadyBody" : "coverReadyBody")}</p>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            {action}
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck className="size-3.5" aria-hidden />{t("generateHint")}</span>
          </div>
        </div>
      )}
      {generating ? (
        <div className="border-t border-brand-emerald-500/20 bg-background/60 px-5 py-4 sm:px-6">
          <ol className="grid grid-cols-3 gap-2" aria-label={t("progressLabel")}>
            {stages.map((item, index) => (
              <li key={item} aria-current={index === activeStage ? "step" : undefined} className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                <span className={`flex size-6 shrink-0 items-center justify-center rounded-full ${index <= activeStage ? "bg-brand-emerald-600 text-white" : "bg-muted text-muted-foreground"}`}>
                  {index < activeStage ? <Check className="size-3.5" aria-hidden /> : index + 1}
                </span>
                <span>{t(item === "generate" ? "progressGenerate" : item === "import" ? "progressImport" : "progressPublish")}</span>
              </li>
            ))}
          </ol>
          <p role="status" aria-live="polite" className="mt-3 text-sm font-medium text-foreground">{status ?? t("generatePreparing")}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t("keepOpen")}</p>
        </div>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="m-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-300"
        >
          <p>{offline ? t("generatorOffline") : error}</p>
          {rescuableOutput ? (
            <p className="mt-2 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={onRetryOutput}
                disabled={generating}
                className="min-h-11 rounded-lg px-2 font-medium underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:no-underline disabled:opacity-60"
              >
                {t("generateRetryImport")}
              </button>
              <button
                type="button"
                onClick={onCopyOutput}
                className="min-h-11 rounded-lg px-2 font-medium underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {outputCopied ? t("generateOutputCopied") : t("generateCopyOutput")}
              </button>
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
