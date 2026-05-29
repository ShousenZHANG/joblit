import { describe, it, expect } from "vitest";
import {
  fadeUp,
  fadeIn,
  stagger,
  floatIn,
  revealOnce,
  revealUp,
  revealStagger,
} from "./motion";

// These assertions lock in the motion contract the landing sections
// depend on. Movement should stay visible but small enough to avoid
// scroll-time jank on long pages.

describe("landing motion variants", () => {
  it("fadeUp has a visible initial offset and spring ease", () => {
    const hidden = fadeUp.hidden as { opacity: number; y: number };
    expect(hidden.opacity).toBe(0);
    // Keep the lift subtle: enough to read as motion, not enough to
    // make long-page scrolling feel delayed.
    expect(hidden.y).toBeGreaterThanOrEqual(12);
    expect(hidden.y).toBeLessThanOrEqual(20);

    const show = fadeUp.show as {
      opacity: number;
      y: number;
      transition: { duration: number; ease: readonly number[] };
    };
    expect(show.opacity).toBe(1);
    expect(show.y).toBe(0);
    // Spring-like cubic bezier (expo-out) keeps the motion silky.
    expect(show.transition.ease).toEqual([0.16, 1, 0.3, 1]);
    expect(show.transition.duration).toBeGreaterThanOrEqual(0.5);
  });

  it("fadeIn is opacity-only (used where y-offset would clip)", () => {
    const hidden = fadeIn.hidden as { opacity: number; y?: number };
    expect(hidden.opacity).toBe(0);
    expect(hidden.y).toBeUndefined();
  });

  it("stagger propagates to children with sub-100ms gap", () => {
    const show = stagger.show as {
      transition: { staggerChildren: number; delayChildren?: number };
    };
    expect(show.transition.staggerChildren).toBeGreaterThan(0);
    expect(show.transition.staggerChildren).toBeLessThan(0.12);
  });

  it("revealUp is TRANSFORM-ONLY — never touches opacity (content stays visible)", () => {
    const hidden = revealUp.hidden as { opacity?: number; y: number };
    // The whole point: opacity is never set, so a missed observer / no-JS /
    // hydration race leaves the section fully readable (worst case 16px low).
    expect(hidden.opacity).toBeUndefined();
    expect(hidden.y).toBeGreaterThanOrEqual(12);
    expect(hidden.y).toBeLessThanOrEqual(20);
    const show = revealUp.show as { opacity?: number; y: number };
    expect(show.opacity).toBeUndefined();
    expect(show.y).toBe(0);
  });

  it("revealStagger propagates to children without an opacity gate", () => {
    expect(revealStagger.hidden).toEqual({});
    const show = revealStagger.show as {
      transition: { staggerChildren: number };
    };
    expect(show.transition.staggerChildren).toBeGreaterThan(0);
  });

  it("floatIn accepts a delay argument and returns valid variants", () => {
    const v = floatIn(0.8);
    const show = v.show as { transition: { delay: number } };
    expect(show.transition.delay).toBe(0.8);
  });

  it("revealOnce fires once when a meaningful slice of the section is visible", () => {
    expect(revealOnce.initial).toBe("hidden");
    expect(revealOnce.whileInView).toBe("show");
    expect(revealOnce.viewport.once).toBe(true);
    // amount must be low enough that tall cards trigger while still
    // entering viewport (avoid the late-reveal trap where the section
    // is mostly visible before any animation runs), but high enough
    // to feel intentional on short rows.
    expect(revealOnce.viewport.amount).toBeGreaterThan(0);
    expect(revealOnce.viewport.amount).toBeLessThanOrEqual(0.25);
    // Positive bottom margin expands the observer root *below* the
    // viewport so the reveal pre-fires before the element is on-screen,
    // producing the "rises into view" feel instead of a late pop.
    expect(revealOnce.viewport.margin).toMatch(/0px 0px \d+%/);
  });
});
