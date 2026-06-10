"use client";

import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
} from "framer-motion";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";

// Pointer-driven interaction primitives for the marketing landing.
//
// Every primitive obeys two hard rules established for this surface:
//   1. GPU-only steady state — interactions animate transform/opacity (or
//      paint inside one small contained overlay), never layout. No perpetual
//      animations: everything idles at zero cost until the pointer arrives.
//   2. Honest degradation — touch devices and prefers-reduced-motion get the
//      exact same content, fully static. Hooks no-op instead of half-animating.

/** True when the device drives a precision pointer (mouse/trackpad). */
function finePointer(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(pointer: fine)").matches
  );
}

function subscribeFinePointer(onChange: () => void) {
  const mq = window.matchMedia("(pointer: fine)");
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/**
 * Hydration-safe fine-pointer flag for RENDER-TIME branches (style props).
 * The server snapshot is `false`, so SSR and the first client paint agree —
 * React then re-renders with the real value post-hydration (the documented
 * useSyncExternalStore pattern). Reading matchMedia directly during render
 * was a hydration mismatch on every pointer device.
 */
function useFinePointer(): boolean {
  return useSyncExternalStore(
    subscribeFinePointer,
    finePointer,
    () => false,
  );
}

/**
 * Tracks the pointer inside an element and mirrors it into the `--gx`/`--gy`
 * CSS variables (px, element-relative). Pure CSS consumes the vars (spotlight
 * gradients in globals.css), so pointer movement never re-renders React —
 * one rAF-coalesced native listener per element.
 */
export function useSpotlight<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el || reduced || !finePointer()) return;
    let raf = 0;
    let lastX = 0;
    let lastY = 0;

    const apply = () => {
      raf = 0;
      el.style.setProperty("--gx", `${lastX}px`);
      el.style.setProperty("--gy", `${lastY}px`);
    };
    const onMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      lastX = e.clientX - rect.left;
      lastY = e.clientY - rect.top;
      if (!raf) raf = requestAnimationFrame(apply);
    };

    el.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      el.removeEventListener("pointermove", onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [reduced]);

  return ref;
}

/**
 * Magnetic wrapper — the child drifts a few px toward the pointer while it
 * hovers, and springs back on leave. The classic Linear/Vercel CTA feel.
 * Wraps (doesn't clone) so any Link/button works unchanged inside.
 */
export function Magnetic({
  children,
  strength = 8,
  className,
}: {
  children: ReactNode;
  /** Max drift in px at the wrapper's edge. */
  strength?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const fine = useFinePointer();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 260, damping: 22, mass: 0.5 });
  const sy = useSpring(y, { stiffness: 260, damping: 22, mass: 0.5 });
  const active = !reduced && fine;

  return (
    <motion.span
      className={className}
      style={active ? { x: sx, y: sy, display: "inline-flex" } : { display: "inline-flex" }}
      onPointerMove={
        active
          ? (e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const nx = (e.clientX - rect.left) / rect.width - 0.5;
              const ny = (e.clientY - rect.top) / rect.height - 0.5;
              x.set(nx * strength * 2);
              y.set(ny * strength * 2);
            }
          : undefined
      }
      onPointerLeave={
        active
          ? () => {
              x.set(0);
              y.set(0);
            }
          : undefined
      }
    >
      {children}
    </motion.span>
  );
}

/**
 * Perspective tilt — the child rotates subtly toward the pointer (max ±`max`
 * degrees) and settles back on leave. Transform-only via springs; the
 * perspective lives on the wrapper so the tilt reads as depth, not skew.
 */
export function TiltCard({
  children,
  max = 4,
  className,
}: {
  children: ReactNode;
  /** Max rotation in degrees on each axis. */
  max?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const fine = useFinePointer();
  const rx = useMotionValue(0);
  const ry = useMotionValue(0);
  const srx = useSpring(rx, { stiffness: 180, damping: 24, mass: 0.6 });
  const sry = useSpring(ry, { stiffness: 180, damping: 24, mass: 0.6 });
  const active = !reduced && fine;

  return (
    <div className={className} style={active ? { perspective: 1200 } : undefined}>
      <motion.div
        style={
          active
            ? { rotateX: srx, rotateY: sry, transformStyle: "preserve-3d" }
            : undefined
        }
        onPointerMove={
          active
            ? (e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const nx = (e.clientX - rect.left) / rect.width - 0.5;
                const ny = (e.clientY - rect.top) / rect.height - 0.5;
                // Pointer right → card yaws right (positive Y rotation);
                // pointer down → card pitches down (negative X rotation).
                ry.set(nx * max * 2);
                rx.set(ny * -max * 2);
              }
            : undefined
        }
        onPointerLeave={
          active
            ? () => {
                rx.set(0);
                ry.set(0);
              }
            : undefined
        }
      >
        {children}
      </motion.div>
    </div>
  );
}

/**
 * Counts 0 → `to` the first time it scrolls into view. Honest numbers only —
 * this animates real stats, it never fabricates them. Reduced-motion renders
 * the final value immediately.
 */
export function CountUp({
  to,
  duration = 1.2,
  className,
}: {
  to: number;
  duration?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  // Always render 0 on the server AND the first client paint (hydration must
  // match); the count starts only from the viewport callback, post-hydration.
  const [value, setValue] = useState(0);
  const started = useRef(false);

  return (
    <motion.span
      className={className}
      viewport={{ once: true, amount: 0.7 }}
      onViewportEnter={() => {
        if (started.current) return;
        started.current = true;
        if (reduced) {
          setValue(to); // no tween — the honest value, immediately
          return;
        }
        animate(0, to, {
          duration,
          ease: [0.16, 1, 0.3, 1],
          onUpdate: (v) => setValue(Math.round(v)),
        });
      }}
    >
      {value}
    </motion.span>
  );
}
