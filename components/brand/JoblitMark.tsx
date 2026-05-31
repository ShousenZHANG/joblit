/**
 * JoblitMark — the canonical Joblit "J" monogram. Source of truth for every
 * in-product brand mark (nav rails, login, OG renders, extension icon).
 *
 * Design: a geometric "J" — top bar + stem curving into a rounded hook — drawn
 * as round-capped strokes on a 64×64 grid. The old mark was a single thin
 * filled hook that read as an awkward hairline at small sizes; this reads
 * cleanly with balanced optical weight from 16→64px.
 *
 * Default `color="currentColor"` lets the mark inherit the parent text colour
 * (how nav rails theme it). `weight` tunes stroke heft. Do not edit the
 * geometry without coordinating with brand.
 */
interface JoblitMarkProps {
  size?: number;
  color?: string;
  className?: string;
  /** Stroke weight on the 64-grid. Default 9 reads well from 16–64px. */
  weight?: number;
  /** Override accessible label. Set null to hide from AT (decorative). */
  ariaLabel?: string | null;
}

export function JoblitMark({
  size = 28,
  color = "currentColor",
  className,
  weight = 9,
  ariaLabel = "Joblit",
}: JoblitMarkProps) {
  const ariaProps =
    ariaLabel === null
      ? { "aria-hidden": true as const }
      : { role: "img" as const, "aria-label": ariaLabel };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      {...ariaProps}
    >
      {/* Top bar of the J */}
      <path d="M27 16 H47" stroke={color} strokeWidth={weight} strokeLinecap="round" />
      {/* Stem + rounded hook */}
      <path
        d="M39 16 V35 a14 14 0 0 1 -28 0"
        stroke={color}
        strokeWidth={weight}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
