import { describe, it, expect } from "vitest";
import { visibleTotalCount } from "./visibleTotalCount";

describe("visibleTotalCount", () => {
  it("returns the raw total when nothing is suppressed", () => {
    expect(visibleTotalCount(3, 3, 3)).toBe(3);
  });

  it("subtracts rows hidden by an in-flight delete", () => {
    // 5 loaded, 4 visible => 1 suppressed in view => 3 of the server's 4 remain.
    expect(visibleTotalCount(4, 5, 4)).toBe(3);
  });

  it("drops to zero when the only loaded row is pending-deleted", () => {
    expect(visibleTotalCount(1, 1, 0)).toBe(0);
  });

  it("never returns a negative count", () => {
    // Raw total lags behind the optimistic view (e.g. mid-refetch).
    expect(visibleTotalCount(0, 1, 0)).toBe(0);
  });

  it("passes through an undefined (still-loading) total", () => {
    expect(visibleTotalCount(undefined, 0, 0)).toBeUndefined();
  });

  it("ignores a negative loaded/visible delta defensively", () => {
    expect(visibleTotalCount(2, 2, 3)).toBe(2);
  });
});
