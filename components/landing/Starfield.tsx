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
    // Keep the narrowed element in an immutable non-null binding for callbacks
    // that outlive this effect's synchronous setup phase.
    const element: HTMLDivElement = root;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const finePointer = window.matchMedia("(pointer: fine)");

    let frame = 0;
    let listening = false;
    function onPointerMove(event: PointerEvent) {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        // Normalise to -1..1 around the viewport centre.
        const px = (event.clientX / window.innerWidth) * 2 - 1;
        const py = (event.clientY / window.innerHeight) * 2 - 1;
        element.style.setProperty("--px", px.toFixed(3));
        element.style.setProperty("--py", py.toFixed(3));
      });
    }

    function stopListening() {
      if (!listening) return;
      window.removeEventListener("pointermove", onPointerMove);
      listening = false;
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
      element.style.removeProperty("--px");
      element.style.removeProperty("--py");
    }

    function syncListener() {
      const shouldListen =
        !reducedMotion.matches &&
        finePointer.matches &&
        document.documentElement.classList.contains("dark");

      if (shouldListen && !listening) {
        window.addEventListener("pointermove", onPointerMove, { passive: true });
        listening = true;
      } else if (!shouldListen) {
        stopListening();
      }
    }

    const themeObserver = new MutationObserver(syncListener);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    reducedMotion.addEventListener("change", syncListener);
    finePointer.addEventListener("change", syncListener);
    syncListener();

    return () => {
      themeObserver.disconnect();
      reducedMotion.removeEventListener("change", syncListener);
      finePointer.removeEventListener("change", syncListener);
      stopListening();
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
