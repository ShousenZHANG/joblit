"use client";

import { useReducedMotion } from "framer-motion";
import { GradientBackground } from "react-gradient-animation";

/* LinkedIn-style: blue + slate + light gray */
const LINKEDIN_BLUE = "#0a66c2";
const BLUE_LIGHT = "#378fe9";
const BLUE_SOFT = "#e7f0f8";
const SLATE = "#64748b";
const SLATE_LIGHT = "#94a3b8";
const BG = "#f3f2ef";

/**
 * Dynamic gradient background (LinkedIn-style palette).
 * Cooler effect: more particles, soft blend; reduced-motion → static orbs.
 */
export function LandingBackground() {
  const reduceMotion = useReducedMotion();

  if (reduceMotion) {
    return (
      <div className="edu-dynamic-bg edu-dynamic-bg--static" aria-hidden="true">
        <div className="edu-dynamic-orb edu-dynamic-orb--blue edu-dynamic-orb--1" />
        <div className="edu-dynamic-orb edu-dynamic-orb--slate edu-dynamic-orb--3" />
      </div>
    );
  }

  return (
    <div
      className="absolute inset-0 z-[1] min-h-[100dvh] w-full overflow-hidden"
      aria-hidden="true"
    >
      <GradientBackground
        count={18}
        size={{ min: 350, max: 650, pulse: 0.35 }}
        speed={{ x: { min: 0.4, max: 1.2 }, y: { min: 0.4, max: 1.2 } }}
        colors={{
          background: BG,
          particles: [LINKEDIN_BLUE, BLUE_LIGHT, BLUE_SOFT, SLATE, SLATE_LIGHT],
        }}
        blending="soft-light"
        opacity={{ center: 0.5, edge: 0.05 }}
        skew={-2}
        shapes={["c", "s"]}
        style={{
          opacity: 0.95,
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
        }}
      />
    </div>
  );
}
