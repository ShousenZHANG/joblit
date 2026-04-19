import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * FilterPill — rounded-full selector with an optional count badge.
 * Active state fills with emerald to match the landing palette; resting
 * state is subtle and theme-token driven so both modes read clearly.
 *
 * Used for the Jobs status filters (All / NEW 12 / APPLIED 28 / REJECTED
 * 7 / Remote) and re-usable across other pages that need the same
 * filter bar affordance.
 */
export interface FilterPillProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  count?: number;
}

export const FilterPill = React.forwardRef<HTMLButtonElement, FilterPillProps>(
  function FilterPill({ active, count, className, children, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        aria-pressed={active}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-semibold transition-all duration-200",
          active
            ? "border-brand-emerald-600 bg-brand-emerald-600 text-white shadow-sm"
            : "border-border/70 bg-background/80 text-foreground/75 hover:border-border hover:bg-muted hover:text-foreground",
          className,
        )}
        {...rest}
      >
        <span>{children}</span>
        {typeof count === "number" ? (
          <span
            className={cn(
              "rounded-full px-1.5 text-[10px] font-bold tabular-nums",
              active
                ? "bg-white/25 text-white"
                : "bg-brand-emerald-50 text-brand-emerald-700",
            )}
          >
            {count}
          </span>
        ) : null}
      </button>
    );
  },
);
