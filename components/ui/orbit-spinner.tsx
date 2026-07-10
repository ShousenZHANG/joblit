import { cn } from "@/lib/utils";

/**
 * Orbit indicator — one point tracing a dashed orbit.
 *
 * Reserved for long "rendering / generating" waits (PDF compile, preview
 * render), where the wait itself is part of the product's cosmic language.
 * Short button-pending states keep the plain spinner.
 *
 * Decorative: always aria-hidden. Keep the surrounding `role="status"` /
 * `aria-busy` / visible waiting copy — this swaps the visual, not the
 * semantics. Freezes into a solid ring under reduced motion.
 */
export function OrbitSpinner({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("orbit-spinner", className)}>
      <span className="orbit-dot" />
    </span>
  );
}
