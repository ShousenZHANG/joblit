import { describe, expect, it } from "vitest";
import { getWorkflowProgress } from "./useWorkflowProgress";

describe("workflow reading and transition rhythm", () => {
  it("gives all three chapters a stable reading interval", () => {
    for (const position of [0, .08, .18]) expect(getWorkflowProgress(position)).toBe(0);
    for (const position of [.4, .5, .6]) expect(getWorkflowProgress(position)).toBe(.5);
    for (const position of [.82, .92, 1]) expect(getWorkflowProgress(position)).toBe(1);
  });

  it("transitions continuously and reversibly, even when the user skips frames", () => {
    const positions = Array.from({ length: 101 }, (_, i) => i / 100);
    const forward = positions.map(getWorkflowProgress);
    expect([...forward].sort((a, b) => a - b)).toEqual(forward);
    expect([...positions].reverse().map(getWorkflowProgress)).toEqual([...forward].reverse());
    for (let i = 1; i < forward.length; i++) expect(forward[i] - forward[i - 1]).toBeLessThan(.04);
    expect(getWorkflowProgress(.29)).toBeCloseTo(.25);
    expect(getWorkflowProgress(.71)).toBeCloseTo(.75);
  });

  it("clamps overscroll and handles unmeasured geometry safely", () => {
    expect(getWorkflowProgress(-.2)).toBe(0);
    expect(getWorkflowProgress(1.2)).toBe(1);
    expect(getWorkflowProgress(Number.NaN)).toBe(0);
  });
});
