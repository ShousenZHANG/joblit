import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * SurfaceCard — landing-aligned card chrome shared across the
 * authenticated app (Jobs, Fetch, Resume, Discover, Extension). Rounded
 * 2xl, token-driven border + background, dual-layer shadow that lifts
 * on hover. Dark-mode parity comes for free from the theme tokens.
 *
 * Use as a generic block wrapper:
 *   <SurfaceCard>...</SurfaceCard>
 * or as a link/button by passing `asChild`-style children — the
 * component only handles style, not polymorphism, so consumers can pass
 * any element via the `as` prop if needed.
 */
export interface SurfaceCardProps
  extends React.HTMLAttributes<HTMLDivElement> {
  /** Visual weight. `raised` gains a stronger shadow + emerald glow
   *  tint, used for hero cells (match breakdown, active job detail). */
  tone?: "default" | "raised" | "flat";
  /** Disable internal padding (consumer provides). */
  unpadded?: boolean;
}

const TONE_CLASS: Record<NonNullable<SurfaceCardProps["tone"]>, string> = {
  default:
    "border border-border/60 bg-background/80 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_6px_20px_-12px_rgba(15,23,42,0.08)] backdrop-blur-sm transition-all duration-300",
  raised:
    "border border-border/60 bg-background shadow-[0_2px_4px_rgba(15,23,42,0.04),0_14px_32px_-14px_rgba(5,150,105,0.2)] backdrop-blur-sm transition-all duration-300",
  flat:
    "border border-border/50 bg-muted/40 transition-colors duration-300",
};

export function SurfaceCard({
  className,
  tone = "default",
  unpadded = false,
  ...rest
}: SurfaceCardProps) {
  return (
    <div
      className={cn(
        "rounded-2xl",
        TONE_CLASS[tone],
        !unpadded && "p-5 sm:p-6",
        className,
      )}
      {...rest}
    />
  );
}
