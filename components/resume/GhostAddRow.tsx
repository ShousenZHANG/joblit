"use client";

import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The add affordance and the empty state, as one element.
 *
 * Previously "Add experience" was a small outline button pinned to the section
 * header while the list below it could be an expanse of nothing. A full-width
 * dashed row sits where the next entry will actually appear, so the list always
 * ends in an obvious invitation and never in dead space.
 */
export function GhostAddRow({
  label,
  onClick,
  className,
}: {
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border py-3",
        "text-[13px] font-medium text-muted-foreground transition-colors duration-150 motion-reduce:transition-none",
        "hover:border-brand-emerald-400 hover:bg-brand-emerald-50/40 hover:text-brand-emerald-text",
        "dark:hover:bg-brand-emerald-500/[0.07]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600 focus-visible:ring-offset-2",
        className,
      )}
    >
      <Plus className="h-4 w-4" aria-hidden />
      {label}
    </button>
  );
}
