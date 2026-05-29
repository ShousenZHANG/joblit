"use client";

import { type Variants, useReducedMotion } from "framer-motion";
import { useRef, type RefObject } from "react";

// Shared framer-motion variants for the marketing landing. Import these
// instead of hand-rolling values per section so reveal timing stays
// consistent and `prefers-reduced-motion` kills them uniformly.

const SPRING_EASE = [0.16, 1, 0.3, 1] as const;

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 18 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.52, ease: SPRING_EASE },
  },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { duration: 0.5, ease: SPRING_EASE },
  },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.98 },
  show: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.36, ease: SPRING_EASE },
  },
};

export const stagger: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.055, delayChildren: 0.03 },
  },
};

export const floatIn = (delay: number): Variants => ({
  hidden: { opacity: 0, y: 8 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, delay, ease: SPRING_EASE },
  },
});

// TRANSFORM-ONLY reveal for on-scroll body sections. opacity is intentionally
// never touched, so even if the IntersectionObserver misses (hydration race,
// no-JS) the content is fully readable — worst case it sits 16px low. This is
// what makes re-enabling scroll reveal safe after the earlier opacity-based
// version left content transparent on fast scroll.
export const revealUp: Variants = {
  hidden: { y: 16 },
  show: { y: 0, transition: { duration: 0.5, ease: SPRING_EASE } },
};

export const revealStagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.04 } },
};

/**
 * Standard reveal-on-scroll props. Spread onto any `<motion.*>` element.
 *
 * Tuned by trial against Landing.html's reference: `amount: 0.12` keeps
 * the threshold low enough that tall sections (Features, Pricing) don't
 * sit visible in their hidden state, and a POSITIVE bottom margin
 * expands the IntersectionObserver root 15% below the viewport so the
 * reveal *pre-fires* while the element is still scrolling in.
 *
 * Retained for components that already use the prop spread. New sections
 * should prefer {@link useReveal} below — the hook form avoids a class
 * of propagation bugs where `whileInView` on a motion.section with
 * child variants would occasionally miss its initial intersection
 * after hydration.
 */
export const revealOnce = {
  initial: "hidden",
  whileInView: "show",
  viewport: { once: true, amount: 0.12, margin: "0px 0px 15% 0px" },
} as const;

export interface RevealProps {
  ref: RefObject<HTMLElement | null>;
  initial: "hidden" | "show";
  animate?: "hidden" | "show";
  whileInView?: "hidden" | "show";
  viewport?: { once: boolean; amount: number; margin?: string };
}

/**
 * Scroll-reveal props for long landing pages. Body sections start at the
 * `hidden` transform and slide to `show` once they scroll into view (observed
 * once). MUST be paired with a TRANSFORM-ONLY variant ({@link revealUp}) so
 * the content is never transparent — that was the bug that made the previous
 * opacity-based reveal unsafe. `prefers-reduced-motion` drops the animation
 * entirely (mounts shown). Hero keeps its own richer entrance.
 *
 * Usage:
 *   const reveal = useReveal();
 *   return <motion.section {...reveal} variants={revealUp}>...</motion.section>;
 */
export function useReveal(): RevealProps {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLElement | null>(null);
  if (reduced) {
    return { ref, initial: "show", animate: "show" };
  }
  return {
    ref,
    initial: "hidden",
    whileInView: "show",
    // Fire slightly before fully in view so the slide completes as the section
    // arrives. once:true = reveal stays put after the first intersection.
    viewport: { once: true, amount: 0.15, margin: "0px 0px -10% 0px" },
  };
}
