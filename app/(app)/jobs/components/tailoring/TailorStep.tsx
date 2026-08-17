"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type TailorStepState = "expanded" | "done" | "future";

interface TailorStepProps {
  index: number;
  title: string;
  description?: string;
  state: TailorStepState;
  /** One-line status shown beside the title on a collapsed done row. */
  summary?: string;
  /** Right-hand slot on a collapsed done row (e.g. the published PDF link). */
  doneAside?: ReactNode;
  /** Expands this phase from its collapsed row; omit to render the row inert. */
  onExpand?: () => void;
  /** Header-right slot of the expanded phase: its primary control or status. */
  action?: ReactNode;
  children?: ReactNode;
}

/**
 * One phase of the tailoring sequence.
 *
 * Exactly one phase is expanded at a time; the rest collapse to single rows,
 * so the column reads as "what is done, what is current, what comes next"
 * without four bodies competing for attention. A collapsed row is clickable
 * whenever its phase is actionable, so going back to re-copy or re-paste is
 * one click rather than a reset.
 */
export function TailorStep({
  index,
  title,
  description,
  state,
  summary,
  doneAside,
  onExpand,
  action,
  children,
}: TailorStepProps) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const expanded = state === "expanded";

  useEffect(() => {
    if (!expanded) return;
    const node = sectionRef.current;
    // jsdom leaves scrollIntoView unimplemented.
    if (node && typeof node.scrollIntoView === "function") {
      node.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [expanded]);

  return (
    <section
      ref={sectionRef}
      data-phase-state={state}
      className="scroll-mt-2 border-t border-border/60 first:border-t-0"
    >
      {expanded ? (
        <div className="flex gap-3.5 py-5">
          <PhaseBadge state={state} index={index} className="mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold tracking-tight text-foreground">
                  {title}
                </h3>
                {description ? (
                  <p className="mt-1 max-w-prose text-xs leading-relaxed text-muted-foreground">
                    {description}
                  </p>
                ) : null}
              </div>
              {action ? <div className="shrink-0">{action}</div> : null}
            </div>
            {children ? <div className="mt-3.5">{children}</div> : null}
          </div>
        </div>
      ) : (
        <CollapsedRow
          state={state}
          index={index}
          title={title}
          summary={summary}
          doneAside={doneAside}
          onExpand={onExpand}
        />
      )}
    </section>
  );
}

function CollapsedRow({
  state,
  index,
  title,
  summary,
  doneAside,
  onExpand,
}: Pick<
  TailorStepProps,
  "state" | "index" | "title" | "summary" | "doneAside" | "onExpand"
>) {
  const done = state === "done";
  const row = (
    <>
      <PhaseBadge state={state} index={index} />
      <span
        className={cn(
          "text-sm font-semibold tracking-tight",
          done ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {title}
      </span>
      {done && summary ? (
        <span className="truncate text-xs text-muted-foreground">{summary}</span>
      ) : null}
    </>
  );
  return (
    <div className="flex items-center gap-3.5 py-3.5">
      {onExpand ? (
        <button
          type="button"
          onClick={onExpand}
          aria-expanded={false}
          className="flex min-w-0 flex-1 items-center gap-3.5 rounded-lg text-left transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
        >
          {row}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3.5">{row}</div>
      )}
      {done && doneAside ? <div className="shrink-0">{doneAside}</div> : null}
    </div>
  );
}

function PhaseBadge({
  state,
  index,
  className,
}: {
  state: TailorStepState;
  index: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums transition-colors duration-200 motion-reduce:transition-none",
        className,
        state === "done" && "bg-brand-emerald-500 text-white",
        state === "expanded" &&
          "bg-brand-emerald-50 text-brand-emerald-text ring-1 ring-brand-emerald-200",
        state === "future" && "bg-muted text-muted-foreground/70 ring-1 ring-border",
      )}
    >
      {state === "done" ? <Check className="h-3.5 w-3.5" /> : index}
    </span>
  );
}
