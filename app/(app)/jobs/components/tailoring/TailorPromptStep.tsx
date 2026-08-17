"use client";

import { useTranslations } from "next-intl";
import { Check, ChevronDown, Copy, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TailorGeneration } from "./useTailorGeneration";
import { TailorStep, type TailorStepState } from "./TailorStep";

interface TailorPromptStepProps {
  index: number;
  state: TailorStepState;
  onExpand: () => void;
  generation: TailorGeneration;
}

export function TailorPromptStep({
  index,
  state,
  onExpand,
  generation,
}: TailorPromptStepProps) {
  const t = useTranslations("tailor.dialog");
  const { prompt, copied, copyPending } = generation;
  const promptText =
    generation.skillPackFresh && prompt.shortText ? prompt.shortText : prompt.text;

  return (
    <TailorStep
      index={index}
      state={state}
      onExpand={onExpand}
      title={t("stepPromptTitle")}
      description={t("stepPromptBody")}
      summary={generation.hasCopied ? t("copied") : undefined}
      action={
        <Button
          type="button"
          size="sm"
          onClick={() => void generation.copyPrompt()}
          className="h-9 min-w-[8.5rem] rounded-full bg-brand-emerald-500 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-emerald-600 motion-reduce:transition-none"
        >
          {copyPending ? (
            <>
              <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden />
              {t("copyPrompt")}
            </>
          ) : copied ? (
            <>
              <Check className="h-4 w-4 animate-in zoom-in-50 duration-200 motion-reduce:animate-none" aria-hidden />
              {t("copied")}
            </>
          ) : (
            <>
              <Copy className="h-4 w-4" aria-hidden />
              {t("copyPrompt")}
            </>
          )}
        </Button>
      }
    >
      {prompt.error ? (
        <p role="alert" className="text-xs font-medium text-destructive">
          {prompt.error}
        </p>
      ) : prompt.loading ? null : (
        <details className="group">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
            <ChevronDown
              className="h-3.5 w-3.5 transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
              aria-hidden
            />
            {t("previewPrompt", { count: promptText.length })}
          </summary>
          <pre className="mt-2 max-h-56 overflow-auto rounded-xl border border-border/70 bg-muted/40 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
            {promptText}
          </pre>
        </details>
      )}
    </TailorStep>
  );
}
