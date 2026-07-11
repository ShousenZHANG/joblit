import type { ReactNode } from "react";

/**
 * Shared kicker label used above every landing section heading.
 * Landing.html renders a 1-pixel emerald rule to the left of the text
 * (`.section-kicker::before`); porting that as a real element keeps the
 * accent consistent across Features / Pricing / HowItWorks / deep-dives
 * without every caller hand-rolling the markup.
 */
export function SectionKicker({
  children,
  align = "center",
  className = "",
}: {
  children: ReactNode;
  align?: "center" | "start";
  className?: string;
}) {
  const justify = align === "center" ? "justify-center" : "justify-start";
  return (
    <div
      className={
        "mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-brand-emerald-text " +
        justify +
        " " +
        className
      }
    >
      <span aria-hidden className="inline-block h-px w-4 bg-brand-emerald-600" />
      {children}
    </div>
  );
}
