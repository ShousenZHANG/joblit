"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { parseTailorOutput } from "../../utils/tailorParser";
import type { TailorTarget } from "./tailorActions";
import { TailorStep, type TailorStepState } from "./TailorStep";

const PLACEHOLDER: Record<TailorTarget, string> = {
  resume: '{\n  "cvSummary": "...",\n  "skillsSelection": [{ "group": 0, "items": [0, 2] }]\n}',
  cover:
    '{\n  "cover": {\n    "paragraphOne": "...",\n    "paragraphTwo": "...",\n    "paragraphThree": "..."\n  }\n}',
};

interface TailorPasteStepProps {
  index: number;
  state: TailorStepState;
  onExpand: () => void;
  target: TailorTarget;
  value: string;
  onChange: (value: string) => void;
  importing: boolean;
  importError: string | null;
  onImport: () => void;
  /**
   * Runs the whole chain from the local sidecar: generate, import, publish.
   * Absent when there is no job to generate for, which keeps the manual path
   * working on its own.
   */
  onGenerate?: () => void;
  generating?: boolean;
  generateStatus?: string | null;
  generateError?: string | null;
  generatorOffline?: boolean;
}

export function TailorPasteStep({
  index,
  state,
  onExpand,
  target,
  value,
  onChange,
  importing,
  importError,
  onImport,
  onGenerate,
  generating = false,
  generateStatus = null,
  generateError = null,
  generatorOffline = false,
}: TailorPasteStepProps) {
  const t = useTranslations("tailor.dialog");
  const parsed = useMemo(() => parseTailorOutput(value, target), [value, target]);
  const hasInput = value.trim().length > 0;

  return (
    <TailorStep
      index={index}
      state={state}
      onExpand={onExpand}
      title={t("stepPasteTitle")}
      description={t("stepPasteBody")}
      summary={t("importedSummary")}
    >
      <div className="space-y-3">
        {onGenerate ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={generating || importing}
                onClick={onGenerate}
                className="h-9 rounded-full px-4 text-sm font-semibold"
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
              <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
                {generating ? generateStatus : t("generateHint")}
              </p>
            </div>
            {generateError ? (
              <p
                role="alert"
                className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400"
              >
                {generatorOffline ? t("generatorOffline") : generateError}
              </p>
            ) : null}
          </div>
        ) : null}
        <Textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-label={t("pasteLabel")}
          placeholder={PLACEHOLDER[target]}
          rows={6}
          className="resize-y font-mono text-xs leading-relaxed"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p
            role="status"
            aria-live="polite"
            className="inline-flex min-h-5 items-center gap-1.5 text-xs"
          >
            {!hasInput ? null : parsed ? (
              <>
                <CheckCircle2
                  className="h-3.5 w-3.5 text-brand-emerald-600"
                  aria-hidden
                />
                <span className="text-brand-emerald-text">{t("parseValid")}</span>
              </>
            ) : (
              <>
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" aria-hidden />
                <span className="text-amber-700 dark:text-amber-400">
                  {t("parseInvalid")}
                </span>
              </>
            )}
          </p>
          <Button
            type="button"
            size="sm"
            disabled={!parsed || importing}
            onClick={onImport}
            data-guide-anchor={target === "resume" ? "generate_first_pdf" : undefined}
            className="h-9 rounded-full bg-brand-emerald-500 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-emerald-600 disabled:bg-muted disabled:text-muted-foreground motion-reduce:transition-none"
          >
            {importing ? (
              <>
                <Loader2
                  className="h-4 w-4 motion-safe:animate-spin"
                  aria-hidden
                />
                {t("importing")}
              </>
            ) : (
              t("importResult")
            )}
          </Button>
        </div>
        {importError ? (
          <p
            role="alert"
            className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive"
          >
            {importError}
          </p>
        ) : null}
      </div>
    </TailorStep>
  );
}
