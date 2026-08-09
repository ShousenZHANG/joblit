"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * SegmentedControl — one choice out of a small fixed set.
 *
 * The connected track is the point: it tells a user the options are mutually
 * exclusive before they click anything, which a row of separate pills cannot.
 *
 * Rendered as a radiogroup with roving tabindex: the whole control is a single
 * tab stop and arrow keys move between segments, which is how assistive tech
 * expects an exclusive choice to behave. Independent buttons would produce one
 * tab stop per option and carry no grouping semantics.
 */
export interface SegmentedControlOption<TValue extends string> {
  value: TValue;
  label: string;
  count?: number;
}

interface SegmentedControlProps<TValue extends string> {
  options: readonly SegmentedControlOption<TValue>[];
  value: TValue;
  onChange: (value: TValue) => void;
  /** Required: a radiogroup with no name is unusable with a screen reader. */
  ariaLabel: string;
  className?: string;
  /**
   * Applied to each segment button. `className` lands on the track, which
   * cannot reach the buttons — a caller in a narrow fixed-width column needs
   * to tighten the segments themselves rather than the container around them.
   */
  segmentClassName?: string;
}

export function SegmentedControl<TValue extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
  segmentClassName,
}: SegmentedControlProps<TValue>) {
  const refs = React.useRef(new Map<TValue, HTMLButtonElement | null>());

  const move = (delta: number) => {
    const index = options.findIndex((option) => option.value === value);
    if (index === -1) return;
    // Wrap: a three-option control is faster to traverse in either direction
    // than one that dead-ends at the edges.
    const next = options[(index + delta + options.length) % options.length];
    onChange(next.value);
    refs.current.get(next.value)?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        move(1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        move(-1);
        break;
      case "Home":
        event.preventDefault();
        onChange(options[0].value);
        refs.current.get(options[0].value)?.focus();
        break;
      case "End": {
        event.preventDefault();
        const last = options[options.length - 1];
        onChange(last.value);
        refs.current.get(last.value)?.focus();
        break;
      }
      default:
        break;
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
      className={cn(
        "inline-flex min-w-0 items-center gap-0.5 rounded-full border border-border/60 bg-muted/50 p-0.5",
        className,
      )}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              refs.current.set(option.value, node);
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1 text-[12px] font-semibold",
              "transition-colors duration-200 focus-visible:outline-none",
              "focus-visible:ring-2 focus-visible:ring-brand-emerald-500/50",
              selected
                ? "bg-brand-emerald-600 text-white shadow-sm"
                : "text-muted-foreground hover:text-foreground",
              segmentClassName,
            )}
          >
            <span className="truncate">{option.label}</span>
            {typeof option.count === "number" ? (
              <span
                className={cn(
                  "rounded-full px-1.5 text-[10px] font-bold tabular-nums",
                  selected
                    ? "bg-white/25 text-white"
                    : "bg-background/80 text-muted-foreground",
                )}
              >
                {option.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
