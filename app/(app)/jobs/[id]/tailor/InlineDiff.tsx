"use client";

import { useMemo } from "react";
import { diffWords, countChanges } from "@/lib/diff/wordDiff";
import { cn } from "@/lib/utils";

interface InlineDiffProps {
  original: string;
  revised: string;
  className?: string;
}

/**
 * Renders a word-level redline of `original` -> `revised`: removed words are
 * struck through in rose, added words are highlighted in emerald, unchanged
 * text is plain. This is the "compare what AI changed" view, modelled on
 * Google Docs suggesting mode / GitHub PR diffs.
 */
export function InlineDiff({ original, revised, className }: InlineDiffProps) {
  const segments = useMemo(() => diffWords(original, revised), [original, revised]);
  return (
    <p
      className={cn(
        "whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground",
        className,
      )}
    >
      {segments.map((seg, i) => {
        if (seg.type === "equal") {
          return <span key={i}>{seg.value}</span>;
        }
        if (seg.type === "added") {
          return (
            <span
              key={i}
              className="rounded-[3px] bg-brand-emerald-100 px-px text-brand-emerald-900 dark:bg-brand-emerald-500/20 dark:text-brand-emerald-200"
            >
              {seg.value}
            </span>
          );
        }
        return (
          <span
            key={i}
            className="rounded-[3px] bg-rose-100 px-px text-rose-700 line-through decoration-rose-400 dark:bg-rose-500/20 dark:text-rose-300"
          >
            {seg.value}
          </span>
        );
      })}
    </p>
  );
}

/** Compact "+N / -N words" summary badge for a diff. Returns null when nothing
 *  changed so callers can hide the compare affordance entirely. */
export function useDiffStats(original: string, revised: string) {
  return useMemo(() => {
    const segments = diffWords(original, revised);
    const { added, removed } = countChanges(segments);
    return { added, removed, hasChanges: added > 0 || removed > 0 };
  }, [original, revised]);
}
