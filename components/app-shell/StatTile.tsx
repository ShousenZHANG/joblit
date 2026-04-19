import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * StatTile — single quantitative cell (SCORE, MATCHED SKILLS, MISSING).
 * Used in the Jobs match-breakdown row and anywhere a headline number
 * needs to sit under a small tracked label. Three tones align with the
 * match-score rubric so the numeric weight also carries semantic color.
 */
export interface StatTileProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  value: React.ReactNode;
  /** Optional unit printed immediately after the value. */
  suffix?: string;
  /** Controls the color of the headline value. Defaults to `foreground`. */
  tone?: "default" | "positive" | "negative" | "warning";
}

const TONE_CLASS: Record<NonNullable<StatTileProps["tone"]>, string> = {
  default: "text-foreground",
  positive: "text-brand-emerald-700",
  negative: "text-destructive",
  warning: "text-amber-600",
};

export function StatTile({
  label,
  value,
  suffix,
  tone = "default",
  className,
  ...rest
}: StatTileProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border/60 bg-background/80 p-4 backdrop-blur-sm",
        className,
      )}
      {...rest}
    >
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "mt-2 flex items-baseline gap-1 text-3xl font-bold tracking-tight tabular-nums",
          TONE_CLASS[tone],
        )}
      >
        <span>{value}</span>
        {suffix ? (
          <span className="text-sm font-semibold text-muted-foreground">
            {suffix}
          </span>
        ) : null}
      </div>
    </div>
  );
}
