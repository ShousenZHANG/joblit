import { describe, expect, it } from "vitest";
import { diffWords, countChanges } from "./wordDiff";

describe("diffWords", () => {
  it("returns a single equal segment for identical text", () => {
    const segs = diffWords("hello world", "hello world");
    expect(segs).toEqual([{ type: "equal", value: "hello world" }]);
  });

  it("marks purely added text", () => {
    const segs = diffWords("", "brand new");
    expect(segs).toEqual([{ type: "added", value: "brand new" }]);
  });

  it("marks purely removed text", () => {
    const segs = diffWords("gone now", "");
    expect(segs).toEqual([{ type: "removed", value: "gone now" }]);
  });

  it("detects a word substitution while keeping the surrounding context equal", () => {
    const segs = diffWords("led the team", "led a team");
    // "led " equal, "the" removed, "a" added, " team" equal (order: removed before added per LCS walk)
    const types = segs.map((s) => s.type);
    expect(types).toContain("removed");
    expect(types).toContain("added");
    // Reconstructing revised from equal+added must equal the revised input.
    const revised = segs
      .filter((s) => s.type !== "removed")
      .map((s) => s.value)
      .join("");
    expect(revised).toBe("led a team");
    // Reconstructing original from equal+removed must equal the original input.
    const original = segs
      .filter((s) => s.type !== "added")
      .map((s) => s.value)
      .join("");
    expect(original).toBe("led the team");
  });

  it("merges adjacent same-type segments", () => {
    const segs = diffWords("a b c", "x y z");
    // All distinct → one removed run + one added run (whitespace handling may
    // interleave, but there should be no two consecutive equal-type segments).
    for (let i = 1; i < segs.length; i++) {
      expect(segs[i].type).not.toBe(segs[i - 1].type);
    }
  });

  it("counts added and removed words, ignoring whitespace-only segments", () => {
    const segs = diffWords("the quick fox", "the slow brown fox");
    const { added, removed } = countChanges(segs);
    expect(added).toBe(2); // "slow brown"
    expect(removed).toBe(1); // "quick"
  });
});
