"use client";

import { motion, useScroll, useSpring, useReducedMotion } from "framer-motion";

/**
 * Linear/Stripe-style scroll progress indicator: a thin emerald bar pinned to
 * the very top of the viewport that fills left→right as the page scrolls. The
 * raw scroll progress is smoothed through a spring so the bar glides instead
 * of tracking scroll 1:1 (which reads as jittery). Reduced-motion users get
 * the un-sprung, direct mapping. Scroll-driven only — no autoplay — so it is
 * safe to keep under prefers-reduced-motion.
 */
export function ScrollProgress() {
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const smooth = useSpring(scrollYProgress, {
    stiffness: 120,
    damping: 30,
    mass: 0.3,
  });
  return (
    <motion.div
      aria-hidden
      style={{ scaleX: reduced ? scrollYProgress : smooth }}
      className="fixed inset-x-0 top-0 z-[60] h-[3px] origin-left bg-gradient-to-r from-brand-emerald-400 via-brand-emerald-500 to-brand-emerald-600 shadow-[0_1px_6px_-1px_rgba(16,185,129,0.5)]"
    />
  );
}
