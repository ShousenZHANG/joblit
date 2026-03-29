import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSearchHistory } from "@/app/(app)/jobs/hooks/useSearchHistory";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe("useSearchHistory", () => {
  it("returns empty array initially", () => {
    const { result } = renderHook(() => useSearchHistory());
    expect(result.current.history).toEqual([]);
  });

  it("adds items to history", () => {
    const { result } = renderHook(() => useSearchHistory());
    act(() => result.current.addToHistory("software engineer"));
    expect(result.current.history).toEqual(["software engineer"]);
  });

  it("inserts new items at the head", () => {
    const { result } = renderHook(() => useSearchHistory());
    act(() => result.current.addToHistory("first"));
    act(() => result.current.addToHistory("second"));
    expect(result.current.history[0]).toBe("second");
    expect(result.current.history[1]).toBe("first");
  });

  it("deduplicates items (moves repeated entry to head)", () => {
    const { result } = renderHook(() => useSearchHistory());
    act(() => result.current.addToHistory("alpha"));
    act(() => result.current.addToHistory("beta"));
    act(() => result.current.addToHistory("alpha"));
    expect(result.current.history).toEqual(["alpha", "beta"]);
  });

  it("truncates to 10 items", () => {
    const { result } = renderHook(() => useSearchHistory());
    for (let i = 0; i < 15; i++) {
      act(() => result.current.addToHistory(`query-${i}`));
    }
    expect(result.current.history).toHaveLength(10);
    expect(result.current.history[0]).toBe("query-14");
  });

  it("clearHistory empties the list", () => {
    const { result } = renderHook(() => useSearchHistory());
    act(() => result.current.addToHistory("keep"));
    act(() => result.current.addToHistory("me"));
    expect(result.current.history).toHaveLength(2);

    act(() => result.current.clearHistory());
    expect(result.current.history).toEqual([]);
  });

  it("ignores blank or whitespace-only entries", () => {
    const { result } = renderHook(() => useSearchHistory());
    act(() => result.current.addToHistory(""));
    act(() => result.current.addToHistory("   "));
    expect(result.current.history).toEqual([]);
  });

  it("handles invalid localStorage data gracefully", () => {
    localStorage.setItem("jobflow:search-history", "not-json{{{");
    const { result } = renderHook(() => useSearchHistory());
    expect(result.current.history).toEqual([]);
  });

  it("handles non-array localStorage data gracefully", () => {
    localStorage.setItem("jobflow:search-history", JSON.stringify({ bad: true }));
    const { result } = renderHook(() => useSearchHistory());
    expect(result.current.history).toEqual([]);
  });

  it("filters out non-string entries from localStorage", () => {
    localStorage.setItem("jobflow:search-history", JSON.stringify(["valid", 42, null, "also-valid"]));
    const { result } = renderHook(() => useSearchHistory());
    expect(result.current.history).toEqual(["valid", "also-valid"]);
  });
});
