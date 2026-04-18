import { describe, it, expect } from "vitest";
import { fadeUp, fadeIn, stagger, floatIn, revealOnce } from "./motion";

// These assertions lock in the motion contract the landing sections
// depend on. If any value drifts (e.g. fadeUp y shrinks to zero, or
// revealOnce loses `once`), reveals stop feeling crisp on long pages.

describe("landing motion variants", () => {
  it("fadeUp has a visible initial offset and spring ease", () => {
    const hidden = fadeUp.hidden as { opacity: number; y: number };
    expect(hidden.opacity).toBe(0);
    // Offset must be >= 28px so the reveal reads as motion, not just fade.
    expect(hidden.y).toBeGreaterThanOrEqual(28);

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
