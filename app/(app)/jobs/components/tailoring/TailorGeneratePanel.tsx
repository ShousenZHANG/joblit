"use client";

import { useTranslations } from "next-intl";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TailorTarget } from "./tailorActions";

interface TailorGeneratePanelProps {
  target: TailorTarget;
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
  return (
    <section className="mb-5 rounded-2xl border border-brand-emerald-500/30 bg-brand-emerald-500/5 px-4 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="sm"
          disabled={generating}
          onClick={onGenerate}
          data-guide-anchor={target === "resume" ? "generate_first_pdf" : undefined}
          className="h-9 rounded-full bg-brand-emerald-500 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-emerald-600 disabled:bg-muted disabled:text-muted-foreground motion-reduce:transition-none"
        >
          {generating ? (
            <>
              <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden />
              {t("generateRunning")}
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" aria-hidden />
              {t("generateLocally")}
            </>
          )}
        </Button>
        <p
          role="status"
          aria-live="polite"
          className="text-xs text-muted-foreground"
        >
          {generating && status ? status : t("generateHint")}
        </p>
      </div>

      {error ? (
        <div
          role="alert"
          className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400"
        >
          <p>{offline ? t("generatorOffline") : error}</p>
          {rescuableOutput ? (
            <p className="mt-2 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={onRetryOutput}
                disabled={generating}
                className="font-medium underline underline-offset-4 disabled:no-underline disabled:opacity-60"
              >
                {t("generateRetryImport")}
              </button>
              <button
                type="button"
                onClick={onCopyOutput}
                className="font-medium underline underline-offset-4"
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
