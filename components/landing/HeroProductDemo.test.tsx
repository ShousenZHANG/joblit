import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HeroProductDemo } from "./HeroProductDemo";

const viewport = vi.hoisted(() => ({ inView: true }));

vi.mock("framer-motion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("framer-motion")>();
  return {
    ...actual,
    useInView: () => viewport.inView,
  };
});

function setDocumentVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("HeroProductDemo interval lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    viewport.inView = true;
    setDocumentVisibility("visible");
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("advances only while the demo is in view", () => {
    const { rerender } = render(
      <HeroProductDemo mounted reduced={false} />,
    );

    expect(screen.getByTestId("hero-demo-row-0")).toHaveAttribute(
      "data-active",
      "true",
    );
    expect(vi.getTimerCount()).toBe(1);

    act(() => vi.advanceTimersByTime(2600));
    expect(screen.getByTestId("hero-demo-row-1")).toHaveAttribute(
      "data-active",
      "true",
    );

    viewport.inView = false;
    rerender(<HeroProductDemo mounted reduced={false} />);
    expect(vi.getTimerCount()).toBe(0);

    act(() => vi.advanceTimersByTime(5200));
    expect(screen.getByTestId("hero-demo-row-1")).toHaveAttribute(
      "data-active",
      "true",
    );

    viewport.inView = true;
    rerender(<HeroProductDemo mounted reduced={false} />);
    expect(vi.getTimerCount()).toBe(1);

    rerender(<HeroProductDemo mounted reduced={false} />);
    expect(vi.getTimerCount()).toBe(1);

    act(() => vi.advanceTimersByTime(2600));
    expect(screen.getByTestId("hero-demo-row-2")).toHaveAttribute(
      "data-active",
      "true",
    );
  });

  it("pauses while the document is hidden and resumes with one timer", () => {
    setDocumentVisibility("hidden");
    render(<HeroProductDemo mounted reduced={false} />);

    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(5200));
    expect(screen.getByTestId("hero-demo-row-0")).toHaveAttribute(
      "data-active",
      "true",
    );

    act(() => setDocumentVisibility("visible"));
    expect(vi.getTimerCount()).toBe(1);
    act(() => vi.advanceTimersByTime(2600));
    expect(screen.getByTestId("hero-demo-row-1")).toHaveAttribute(
      "data-active",
      "true",
    );

    act(() => setDocumentVisibility("hidden"));
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(5200));
    expect(screen.getByTestId("hero-demo-row-1")).toHaveAttribute(
      "data-active",
      "true",
    );

    act(() => setDocumentVisibility("visible"));
    expect(vi.getTimerCount()).toBe(1);
    act(() => setDocumentVisibility("visible"));
    expect(vi.getTimerCount()).toBe(1);
  });

  it("does not schedule a timer when reduced motion is preferred", () => {
    const { rerender } = render(
      <HeroProductDemo mounted reduced />,
    );

    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(5200));
    expect(screen.getByTestId("hero-demo-row-0")).toHaveAttribute(
      "data-active",
      "true",
    );

    rerender(<HeroProductDemo mounted reduced={false} />);
    expect(vi.getTimerCount()).toBe(1);

    rerender(<HeroProductDemo mounted reduced />);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears its timer when unmounted", () => {
    const { unmount } = render(
      <HeroProductDemo mounted reduced={false} />,
    );

    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
