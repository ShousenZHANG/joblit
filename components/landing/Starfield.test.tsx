import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Starfield } from "./Starfield";

let reducedMotion = false;
let finePointer = true;

describe("Starfield pointer parallax", () => {
  beforeEach(() => {
    reducedMotion = false;
    finePointer = true;
    document.documentElement.classList.remove("dark");
    vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({
      matches: query.includes("prefers-reduced-motion")
        ? reducedMotion
        : query.includes("pointer: fine")
          ? finePointer
          : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  afterEach(() => {
    cleanup();
    document.documentElement.classList.remove("dark");
    vi.restoreAllMocks();
  });

  it("does not register global pointer work while the starfield is hidden in light mode", () => {
    const add = vi.spyOn(window, "addEventListener");
    render(<Starfield />);

    expect(add.mock.calls.some(([type]) => type === "pointermove")).toBe(false);
  });

  it("does not register pointer work on coarse pointers", () => {
    finePointer = false;
    document.documentElement.classList.add("dark");
    const add = vi.spyOn(window, "addEventListener");
    render(<Starfield />);

    expect(add.mock.calls.some(([type]) => type === "pointermove")).toBe(false);
  });

  it("arms parallax when the document switches to dark mode on a fine pointer", async () => {
    const add = vi.spyOn(window, "addEventListener");
    render(<Starfield />);

    document.documentElement.classList.add("dark");

    await waitFor(() => {
      expect(add.mock.calls.some(([type]) => type === "pointermove")).toBe(true);
    });
  });
});
