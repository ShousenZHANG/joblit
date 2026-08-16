"use client";

import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type TailorStepState = "locked" | "todo" | "active" | "done";

interface TailorStepProps {
  index: number;
  title: string;
  description?: string;
  state: TailorStepState;
  /** Header-right slot: the step's primary control, or a status. */
  action?: ReactNode;
  children?: ReactNode;
}

/**
 * One step of the tailoring sequence.
 *
 * Deliberately not wizard chrome: every step stays on screen in one column, so
 * the numbers are a reading order rather than a set of gates. A locked step
 * still shows its title — knowing Publish exists is the point of listing it.
 */
export function TailorStep({
  index,
  title,
  description,
  state,
  action,
  children,
}: TailorStepProps) {
  const locked = state === "locked";
  return (
    <section
      data-step-state={state}
      className="border-t border-border/60 py-5 first:border-t-0 first:pt-1"
    >
      <div className="flex gap-3.5">
        <span
          aria-hidden
          className={cn(
            "mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums transition-colors duration-200 motion-reduce:transition-none",
            state === "done" && "bg-brand-emerald-500 text-white",
            state === "active" &&
              "bg-brand-emerald-50 text-brand-emerald-text ring-1 ring-brand-emerald-200",
            (state === "todo" || locked) &&
              "bg-muted text-muted-foreground/70 ring-1 ring-border",
          )}
        >
          {state === "done" ? <Check className="h-3.5 w-3.5" /> : index}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div className="min-w-0">
              <h3
                className={cn(
                  "text-sm font-semibold tracking-tight",
                  locked ? "text-muted-foreground" : "text-foreground",
                )}
              >
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
    </section>
  );
}
