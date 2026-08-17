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

  it("mirrors the current nav, AU-only intake, and the Tailor action row", () => {
    render(<HeroProductDemo mounted reduced />);

    // The demo nav mirrors the real one: three pages, nothing retired.
    expect(screen.getByText("Jobs")).toBeInTheDocument();
    expect(screen.getByText("Resume")).toBeInTheDocument();
    expect(screen.queryByText("Agent")).not.toBeInTheDocument();
    expect(screen.queryByText("Discover")).not.toBeInTheDocument();
    expect(screen.queryByText("Extension")).not.toBeInTheDocument();

    // Fetch is AU-only (ADR-0017): the mock rows must be Australian roles,
    // not a Bay Area wish list the product cannot deliver.
    expect(screen.getByText("Atlassian · Sydney")).toBeInTheDocument();
    expect(screen.getByText("Canva · Sydney")).toBeInTheDocument();
    expect(screen.getByText("Airwallex · Melbourne")).toBeInTheDocument();
    expect(screen.getByText("SEEK · Melbourne")).toBeInTheDocument();

    // Tailoring is one dialog per job (ADR-0022): a single solid Tailor
    // action plus the Saved CV/CL re-entry ghosts — no batch queue and no
    // live progress count.
    expect(screen.getByText("Tailor")).toBeInTheDocument();
    expect(screen.getByText("Saved CV")).toBeInTheDocument();
    expect(screen.getByText("Saved CL")).toBeInTheDocument();
    expect(screen.queryByText("AI Generate")).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+ of \d+ done/)).not.toBeInTheDocument();
  });
});
