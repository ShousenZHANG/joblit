"use client";

import type { HTMLAttributes, ReactNode } from "react";
import { ChevronDown, GripVertical, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/**
 * One repeatable entry (a job, a project, a degree, a skill group).
 *
 * Collapsed, it is a summary row — the thing the user is actually scanning
 * for: "Senior Engineer · Stripe" over "Experience 2". The pattern is the one
 * every current builder converged on: a dedicated drag handle that stays quiet
 * until hover (so the reorder affordance never competes with the click target),
 * the summary, then destructive actions revealed on hover.
 *
 * Expansion is inline rather than in a dialog: this editor sits beside a live
 * PDF preview, and a modal would cover the very thing the user is editing
 * toward.
 *
 * Up/down buttons are deliberately gone from the visual row. Reordering by
 * keyboard is handled by the drag handle itself, which dnd-kit makes operable
 * with Space + arrow keys — the accessible path without the button clutter.
 */

interface EntryCardProps {
  /** Primary summary line — falls back to a neutral label when still empty. */
  title: string;
  /** Secondary summary line (company, stack, dates). */
  subtitle?: string;
  /** Placeholder used when the entry has no title yet. */
  untitledLabel: string;
  expanded: boolean;
  onToggle: () => void;
  onRemove?: () => void;
  removeLabel: string;
  dragHandleProps: HTMLAttributes<HTMLButtonElement>;
  dragHandleLabel: string;
  isDragging?: boolean;
  children: ReactNode;
}

export function EntryCard({
  title,
  subtitle,
  untitledLabel,
  expanded,
  onToggle,
  onRemove,
  removeLabel,
  dragHandleProps,
  dragHandleLabel,
  isDragging,
  children,
}: EntryCardProps) {
  const t = useTranslations("resumeForm");
  const hasTitle = title.trim().length > 0;

  return (
    <div
      data-expanded={expanded ? "true" : "false"}
      className={cn(
        "group/entry rounded-xl border border-border bg-card transition-[box-shadow,border-color] duration-150 motion-reduce:transition-none",
        "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 motion-safe:duration-150",
        expanded
          ? "border-border shadow-[0_4px_16px_-8px_rgba(15,23,42,0.14)]"
          : "hover:border-border hover:shadow-[0_2px_8px_-4px_rgba(15,23,42,0.10)]",
        isDragging && "opacity-60",
      )}
    >
      <div className="flex items-center gap-1 py-1.5 pl-1.5 pr-2">
        <button
          type="button"
          aria-label={dragHandleLabel}
          title={dragHandleLabel}
          className={cn(
            "grid h-8 w-6 shrink-0 cursor-grab place-items-center rounded-md text-muted-foreground/40 active:cursor-grabbing",
            "transition-opacity duration-150 group-hover/entry:text-muted-foreground motion-reduce:transition-none",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600",
          )}
          onClick={(event) => {
            // The handle exists to drag; a stray click must not toggle the card.
            event.preventDefault();
            event.stopPropagation();
          }}
          {...dragHandleProps}
        >
          <GripVertical className="h-4 w-4" aria-hidden />
        </button>

        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600"
        >
          <span className="min-w-0 flex-1">
            <span
              className={cn(
                "block truncate text-sm font-semibold",
                hasTitle ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {hasTitle ? title : untitledLabel}
            </span>
            {subtitle ? (
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                {subtitle}
              </span>
            ) : null}
          </span>
          <ChevronDown
            aria-hidden
            className={cn(
              "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none",
              expanded && "rotate-180",
            )}
          />
        </button>

        {onRemove ? (
          <button
            type="button"
            aria-label={removeLabel}
            title={removeLabel}
            onClick={onRemove}
            className={cn(
              "grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground/0 transition-colors duration-150 motion-reduce:transition-none",
              "group-hover/entry:text-muted-foreground hover:!text-destructive focus-visible:text-muted-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-emerald-600",
            )}
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        ) : null}
      </div>

      {expanded ? (
        <div className="space-y-4 border-t border-border/70 px-4 pb-4 pt-4">
          {children}
        </div>
      ) : null}
      {/* Keeps the collapsed state honest for assistive tech without rendering
          the whole field set into the accessibility tree twice. */}
      <span className="sr-only">{expanded ? t("expanded") : t("collapsed")}</span>
    </div>
  );
}
