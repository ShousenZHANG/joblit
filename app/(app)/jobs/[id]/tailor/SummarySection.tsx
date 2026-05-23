"use client";

import { useState } from "react";
import { ChevronDown, RotateCcw, Sparkles } from "lucide-react";
import type { AiSummary } from "@/lib/shared/schemas/aiContent";
import { cn } from "@/lib/utils";

interface SummarySectionProps {
  summary: AiSummary;
  onChange: (next: AiSummary) => void;
}

export function SummarySection({ summary, onChange }: SummarySectionProps) {
  const [showOriginal, setShowOriginal] = useState(false);
  const value = summary.userEdit ?? summary.aiText;
  const isUserEdited = summary.userEdit !== undefined && summary.userEdit !== summary.aiText;

  return (
    <section className="space-y-3 rounded-[1.35rem] border border-border/70 bg-card p-4 shadow-[0_18px_46px_-36px_rgba(15,23,42,0.45),0_1px_0_rgba(255,255,255,0.9)_inset] ring-1 ring-border/40">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-brand-emerald-50 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-brand-emerald-700 ring-1 ring-brand-emerald-100">
            <Sparkles className="h-3 w-3" aria-hidden />
            AI rewrote
          </span>
          <h2 className="text-sm font-semibold tracking-tight text-foreground">
            Summary
          </h2>
        </div>
        {isUserEdited ? (
          <button
            type="button"
            onClick={() =>
              onChange({ ...summary, userEdit: undefined, accepted: true })
            }
            className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <RotateCcw className="h-3 w-3" aria-hidden />
            Reset to AI
          </button>
        ) : null}
      </header>

      <textarea
        value={value}
        onChange={(e) =>
          onChange({
            ...summary,
            userEdit: e.target.value === summary.aiText ? undefined : e.target.value,
            accepted: true,
          })
        }
        rows={4}
        className="w-full resize-y rounded-2xl border border-border/70 bg-background px-3 py-2.5 text-sm leading-relaxed text-foreground shadow-inner shadow-black/5 placeholder:text-muted-foreground/60 focus-visible:border-brand-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-400/40"
        placeholder="Summary"
        aria-label="Resume summary"
      />

      {summary.originalText && summary.originalText !== summary.aiText ? (
        <div>
          <button
            type="button"
            onClick={() => setShowOriginal((v) => !v)}
            className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            aria-expanded={showOriginal}
          >
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 transition-transform duration-200",
                showOriginal && "rotate-180",
              )}
              aria-hidden
            />
            See original
          </button>
          {showOriginal ? (
            <p className="mt-2 rounded-xl border border-dashed border-border bg-muted/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
              {summary.originalText}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
