"use client";

import { useReducedMotion } from "framer-motion";

/**
 * 简洁动态背景：暖色主风格，mint/peach/cream 三枚光球轻微浮动。
 * prefers-reduced-motion 时仅保留静态。
 */
export function LandingBackground() {
  const reduceMotion = useReducedMotion();

  if (reduceMotion) {
    return (
      <div className="edu-dynamic-bg edu-dynamic-bg--static" aria-hidden="true">
        <div className="edu-dynamic-orb edu-dynamic-orb--mint edu-dynamic-orb--1" />
        <div className="edu-dynamic-orb edu-dynamic-orb--peach edu-dynamic-orb--2" />
      </div>
    );
  }

  return (
    <div className="edu-dynamic-bg" aria-hidden="true">
      <div className="edu-dynamic-orb edu-dynamic-orb--mint edu-dynamic-orb--1" />
      <div className="edu-dynamic-orb edu-dynamic-orb--peach edu-dynamic-orb--2" />
      <div className="edu-dynamic-orb edu-dynamic-orb--cream edu-dynamic-orb--3" />
    </div>
  );
}
