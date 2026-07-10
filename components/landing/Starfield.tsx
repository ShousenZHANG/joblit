"use client";

import { useEffect, useRef } from "react";

/**
 * Sparse three-layer starfield with pointer parallax. Dark mode only.
 *
 * Each layer is ONE element whose stars are `box-shadow` copies — 55 stars
 * across three DOM nodes instead of 55, so parallax is a single GPU-composited
 * transform per layer. Purely decorative: aria-hidden, pointer-events-none, and
 * fully frozen under prefers-reduced-motion.
 */
export function Starfield() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    // Respect reduced motion: never arm the listener, leave layers at rest.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    function onPointerMove(event: PointerEvent) {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        if (!root) return;
        // Normalise to -1..1 around the viewport centre.
        const px = (event.clientX / window.innerWidth) * 2 - 1;
        const py = (event.clientY / window.innerHeight) * 2 - 1;
        root.style.setProperty("--px", px.toFixed(3));
        root.style.setProperty("--py", py.toFixed(3));
      });
    }

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div ref={rootRef} aria-hidden className="starfield">
      <span className="starfield-layer starfield-far" />
      <span className="starfield-layer starfield-mid" />
      <span className="starfield-layer starfield-near" />
      {/* One meteor every ~16s, gone in under a second. */}
      <span className="shooting-star" />
    </div>
  );
}
