"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, RotateCcw } from "lucide-react";
import type { AiSummary } from "@/lib/shared/schemas/aiContent";
import { CV_SUMMARY_LENGTH } from "@/lib/shared/schemas/applicationGenerationOutput";
import { cn } from "@/lib/utils";
import { InlineDiff, useDiffStats } from "./InlineDiff";

interface SummarySectionProps {
  summary: AiSummary;
  onChange: (next: AiSummary) => void;
}

export function SummarySection({ summary, onChange }: SummarySectionProps) {
  const t = useTranslations("tailor");
  const [showDiff, setShowDiff] = useState(false);
  const value = summary.userEdit ?? summary.aiText;
  const isUserEdited =
    summary.userEdit !== undefined && summary.userEdit !== summary.aiText;
  const original = summary.originalText ?? "";
  const diffStats = useDiffStats(original, value);
  // The same window the import boundary enforces. Showing it live is the only
  // way an edit that would be rejected on publish is visible while typing.
  const outOfRange =
    value.trim().length < CV_SUMMARY_LENGTH.min ||
    value.trim().length > CV_SUMMARY_LENGTH.max;

  return (
    <section className="space-y-2.5">
      <header className="flex items-center justify-between gap-3">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/80">
          {t("summary.title")}
        </h4>
        <div className="flex items-center gap-2">
          <span
            aria-live="polite"
            className={cn(
              "text-[11px] tabular-nums",
              outOfRange ? "font-semibold text-amber-600" : "text-muted-foreground",
            )}
          >
            {t("summary.counter", {
              count: value.trim().length,
              min: CV_SUMMARY_LENGTH.min,
              max: CV_SUMMARY_LENGTH.max,
            })}
          </span>
          {isUserEdited ? (
            <button
              type="button"
              onClick={() =>
                onChange({ ...summary, userEdit: undefined, accepted: true })
              }
              className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <RotateCcw className="h-3 w-3" aria-hidden />
              {t("resetToAi")}
            </button>
          ) : null}
        </div>
      </header>

      <textarea
        value={value}
        onChange={(event) =>
          onChange({
            ...summary,
            userEdit:
              event.target.value === summary.aiText
                ? undefined
                : event.target.value,
            accepted: true,
          })
        }
        rows={4}
        className="w-full resize-y rounded-xl border border-border/70 bg-background px-4 py-3 text-base leading-relaxed sm:text-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:border-brand-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-400/40"
        placeholder={t("summary.placeholder")}
        aria-label={t("summary.aria")}
      />

      {original && diffStats.hasChanges ? (
        <div>
          <button
            type="button"
            onClick={() => setShowDiff((visible) => !visible)}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            aria-expanded={showDiff}
          >
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 transition-transform duration-200 motion-reduce:transition-none",
                showDiff && "rotate-180",
              )}
              aria-hidden
            />
            {showDiff ? t("summary.hideChanges") : t("summary.compareChanges")}
            <span className="ml-0.5 inline-flex items-center gap-1 text-[10px] font-semibold tabular-nums">
              <span className="text-brand-emerald-600">+{diffStats.added}</span>
              <span className="text-rose-500">&minus;{diffStats.removed}</span>
            </span>
          </button>
          {showDiff ? (
            <div className="mt-2 rounded-xl border border-dashed border-border bg-muted/40 px-3 py-2.5">
              <div className="mb-1.5 flex flex-wrap items-center gap-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-[2px] bg-rose-300" aria-hidden />
                  {t("summary.yourOriginal")}
                </span>
                <span className="inline-flex items-center gap-1">
                  <span
                    className="h-2 w-2 rounded-[2px] bg-brand-emerald-300"
                    aria-hidden
                  />
                  {t("summary.aiAndYourEdits")}
                </span>
              </div>
              <InlineDiff original={original} revised={value} />
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
