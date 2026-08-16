"use client";

import { useTranslations } from "next-intl";
import { Check, ChevronDown, Copy, Download, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TailorGeneration } from "./useTailorGeneration";
import { TailorStep, type TailorStepState } from "./TailorStep";

interface TailorPromptStepProps {
  index: number;
  state: TailorStepState;
  generation: TailorGeneration;
}

export function TailorPromptStep({
  index,
  state,
  generation,
}: TailorPromptStepProps) {
  const t = useTranslations("tailor.dialog");
  const { prompt, copied } = generation;
  const promptText =
    generation.skillPackFresh && prompt.shortText ? prompt.shortText : prompt.text;
  const disabled = prompt.loading || !promptText.trim();

  return (
    <TailorStep
      index={index}
      state={state}
      title={t("stepPromptTitle")}
      description={t("stepPromptBody")}
      action={
        <Button
          type="button"
          size="sm"
          disabled={disabled}
          onClick={() => void generation.copyPrompt()}
          className="h-9 min-w-[8.5rem] rounded-full bg-brand-emerald-500 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-emerald-600 disabled:bg-muted disabled:text-muted-foreground motion-reduce:transition-none"
        >
          {prompt.loading ? (
            t("buildingPrompt")
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
      ) : (
        <div className="space-y-2.5">
          <SkillPackLink generation={generation} />
          {prompt.loading ? (
            <div className="h-3 w-40 animate-pulse rounded bg-muted" aria-hidden />
          ) : (
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
        </div>
      )}
    </TailorStep>
  );
}

function SkillPackLink({ generation }: { generation: TailorGeneration }) {
  const t = useTranslations("tailor.dialog");
  const { skillPackFresh, skillPackLoading, prompt } = generation;
  if (skillPackFresh) {
    return (
      <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Package className="h-3.5 w-3.5 text-brand-emerald-600" aria-hidden />
        {t("skillPackFresh")}
        <button
          type="button"
          onClick={() => void generation.downloadSkillPack()}
          disabled={skillPackLoading || !prompt.meta}
          className="underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50"
        >
          {skillPackLoading ? t("skillPackDownloading") : t("skillPackRedownload")}
        </button>
      </p>
    );
  }
  return (
    <button
      type="button"
      onClick={() => void generation.downloadSkillPack()}
      disabled={skillPackLoading || !prompt.meta}
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium text-brand-emerald-text underline-offset-4 transition-colors hover:underline",
        "disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline",
      )}
    >
      <Download className="h-3.5 w-3.5" aria-hidden />
      {skillPackLoading ? t("skillPackDownloading") : t("skillPackDownload")}
    </button>
  );
}
