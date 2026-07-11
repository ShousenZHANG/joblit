import { describe, it, expect } from "vitest";
import {
  hasContent,
  hasBullets,
  normalizeBullets,
  normalizeCommaItems,
  remapFocusedIndex,
} from "./utils";

describe("hasContent", () => {
  it("returns true for non-empty string", () => {
    expect(hasContent("hello")).toBe(true);
  });

  it("returns true for string with only non-whitespace characters", () => {
    expect(hasContent("a")).toBe(true);
  });

  it("returns false for empty string", () => {
    expect(hasContent("")).toBe(false);
  });

  it("returns false for whitespace-only string", () => {
    expect(hasContent("   ")).toBe(false);
  });

  it("returns false for tab-only string", () => {
    expect(hasContent("\t")).toBe(false);
  });

  it("returns true for string with surrounding whitespace", () => {
    expect(hasContent("  hello  ")).toBe(true);
  });
});

describe("hasBullets", () => {
  it("returns true when at least one item has content", () => {
    expect(hasBullets(["", "has content", ""])).toBe(true);
  });

  it("returns true when all items have content", () => {
    expect(hasBullets(["a", "b", "c"])).toBe(true);
  });

  it("returns false when all items are empty", () => {
    expect(hasBullets(["", "", ""])).toBe(false);
  });

  it("returns false for empty array", () => {
    expect(hasBullets([])).toBe(false);
  });

  it("returns false when items are whitespace only", () => {
    expect(hasBullets(["  ", "\t", ""])).toBe(false);
  });

  it("returns true when single item has content", () => {
    expect(hasBullets(["content"])).toBe(true);
  });
});

describe("normalizeBullets", () => {
  it("trims whitespace from items", () => {
    expect(normalizeBullets(["  hello  ", "world"])).toEqual(["hello", "world"]);
  });

  it("filters out empty strings", () => {
    expect(normalizeBullets(["a", "", "b"])).toEqual(["a", "b"]);
  });

  it("filters out whitespace-only strings after trim", () => {
    expect(normalizeBullets(["a", "   ", "b"])).toEqual(["a", "b"]);
  });

  it("returns empty array for all-empty input", () => {
    expect(normalizeBullets(["", "  "])).toEqual([]);
  });

  it("returns empty array for empty input", () => {
    expect(normalizeBullets([])).toEqual([]);
  });

  it("preserves order of non-empty items", () => {
    expect(normalizeBullets(["c", "a", "b"])).toEqual(["c", "a", "b"]);
  });
});

describe("normalizeCommaItems", () => {
  it("splits by comma and trims", () => {
    expect(normalizeCommaItems("a, b, c")).toEqual(["a", "b", "c"]);
  });

  it("filters out empty items", () => {
    expect(normalizeCommaItems("a,,b")).toEqual(["a", "b"]);
  });

  it("handles no commas", () => {
    expect(normalizeCommaItems("single")).toEqual(["single"]);
  });

  it("returns empty array for empty string", () => {
    expect(normalizeCommaItems("")).toEqual([]);
  });

  it("returns empty array for whitespace-only string", () => {
    expect(normalizeCommaItems("  ")).toEqual([]);
  });

  it("handles trailing commas", () => {
    expect(normalizeCommaItems("a, b,")).toEqual(["a", "b"]);
  });

  it("handles leading commas", () => {
    expect(normalizeCommaItems(",a, b")).toEqual(["a", "b"]);
  });

  it("handles items with extra whitespace", () => {
    expect(normalizeCommaItems("  a  ,  b  ")).toEqual(["a", "b"]);
  });
});

describe("remapFocusedIndex", () => {
  it("returns destination when focused item is moved", () => {
    expect(remapFocusedIndex(2, 2, 5)).toBe(5);
  });

  it("shifts down when item moves forward past focused", () => {
    // from=0 to=3: items between (1,2,3) shift down by 1
    expect(remapFocusedIndex(2, 0, 3)).toBe(1);
  });

  it("shifts up when item moves backward before focused", () => {
    // from=4 to=1: items between (1,2,3,4) shift up by 1
    expect(remapFocusedIndex(2, 4, 1)).toBe(3);
  });

  it("returns same index when move does not affect focused item", () => {
    // from=3 to=5: focused at 1 is unaffected
    expect(remapFocusedIndex(1, 3, 5)).toBe(1);
  });

  it("returns same index when from equals to (no-op move)", () => {
    expect(remapFocusedIndex(2, 2, 2)).toBe(2);
  });

  it("focused item at boundary: forward move, focused at to boundary", () => {
    // from=0 to=3, focused at 3: focused is at `to`, so shifts down to 2
    expect(remapFocusedIndex(3, 0, 3)).toBe(2);
  });

  it("focused item at boundary: backward move, focused at to boundary", () => {
    // from=4 to=1, focused at 1: focused is at `to`, so shifts up to 2
    expect(remapFocusedIndex(1, 4, 1)).toBe(2);
  });

  it("does not affect focused item above range of forward move", () => {
    // from=1 to=3, focused at 0: unaffected
    expect(remapFocusedIndex(0, 1, 3)).toBe(0);
  });

  it("does not affect focused item below range of backward move", () => {
    // from=3 to=1, focused at 0: unaffected
    expect(remapFocusedIndex(0, 3, 1)).toBe(0);
  });
});
