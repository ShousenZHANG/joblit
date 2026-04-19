import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * SectionLabel — the compact uppercase tracked label that sits above
 * stat blocks, breakdowns, and field groups (MATCH BREAKDOWN, JOB
 * DESCRIPTION, MATCHED SKILLS, etc.). Smaller than the landing
 * SectionKicker — this is for in-panel headings, not section openings.
 */
export interface SectionLabelProps
  extends React.HTMLAttributes<HTMLDivElement> {
  /** Show a small emerald leading rule before the text. */
  leading?: boolean;
}

export function SectionLabel({
  leading = false,
  className,
  children,
  ...rest
}: SectionLabelProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground",
        className,
      )}
      {...rest}
    >
      {leading ? (
        <span
          aria-hidden
          className="inline-block h-px w-3 bg-brand-emerald-500"
        />
      ) : null}
      {children}
    </div>
  );
}
