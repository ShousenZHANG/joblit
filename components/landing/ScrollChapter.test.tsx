import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScrollChapter, DepthLayer } from "./ScrollChapter";
import { LandingMotionProvider } from "./lib/LandingMotion";

const scroll = vi.hoisted(() => ({ current: null as import("framer-motion").MotionValue<number> | null }));
vi.mock("framer-motion", async importOriginal => {
  const actual = await importOriginal<typeof import("framer-motion")>();
  scroll.current = actual.motionValue(0.5);
  return { ...actual, useScroll: () => ({ scrollYProgress: scroll.current }) };
});

describe("ScrollChapter progressive enhancement", () => {
  let contentHeight = 500;
  let desktop = true;
  let reduced = false;
  let resize: () => void;

  beforeEach(() => {
    scroll.current!.set(0.5);
    contentHeight = 500;
    desktop = true;
    reduced = false;
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(900);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(() => contentHeight);
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(() => contentHeight);
    vi.spyOn(window, "matchMedia").mockImplementation(query => ({
      matches: query.includes("prefers-reduced-motion") ? reduced : desktop,
      media: query,
      onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    }));
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) { resize = callback; }
      observe() {}
      disconnect() {}
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function chapter(interactive = false) {
    return render(<>
      <ScrollChapter id="features" labelledBy="feature-heading" interactive={interactive}>
        <h2 id="feature-heading">Your experience</h2>
        <DepthLayer depth={1.2} tilt={4}><button type="button">Open resume</button></DepthLayer>
        <button type="button">Open cover letter</button>
      </ScrollChapter>
      <button type="button">Continue outside</button>
    </>);
  }

  it("fits desktop content in a screen without hiding it or intercepting native scrolling", () => {
    chapter();
    const region = screen.getByRole("region", { name: "Your experience" });
    expect(region).toHaveAttribute("data-chapter-layout", "screen");
    expect(screen.getByRole("button", { name: "Open resume" })).toBeVisible();
    expect(region.querySelector("[aria-hidden], [inert]")).toBeNull();
    const wheel = new WheelEvent("wheel", { deltaY: 320, bubbles: true, cancelable: true });
    expect(region.dispatchEvent(wheel)).toBe(true);
    expect(wheel.defaultPrevented).toBe(false);
  });

  it("allows expanded content to grow beyond a screen and preserves keyboard focus", () => {
    chapter();
    const region = screen.getByRole("region", { name: "Your experience" });
    const button = screen.getByRole("button", { name: "Open resume" });
    button.focus();
    act(() => { contentHeight = 820; resize(); });

    expect(region).toHaveAttribute("data-chapter-layout", "flow");
    expect(button).toHaveFocus();
    expect(screen.getByRole("button", { name: "Open cover letter" })).toBeVisible();
    expect(region).not.toHaveAttribute("data-chapter-still");

    act(() => { contentHeight = 500; resize(); });
    expect(region).toHaveAttribute("data-chapter-layout", "screen");
    expect(button).toHaveFocus();
  });

  it.each(["small screen", "reduced motion"])("keeps normal flow for %s", mode => {
    if (mode === "small screen") desktop = false;
    else reduced = true;
    chapter();
    const region = screen.getByRole("region", { name: "Your experience" });
    expect(region).toHaveAttribute("data-chapter-layout", "flow");
    expect(region).toHaveAttribute("data-chapter-still", "true");
    expect(screen.getByRole("button", { name: "Open resume" }).parentElement).toHaveStyle({ transform: "none" });
  });

  it("does not reset an entering chapter on hover and holds its current pose during keyboard use", () => {
    scroll.current!.set(0.2);
    chapter(true);
    const region = screen.getByRole("region", { name: "Your experience" });
    const camera = region.firstElementChild!.firstElementChild!;
    const resume = screen.getByRole("button", { name: "Open resume" });
    const letter = screen.getByRole("button", { name: "Open cover letter" });
    fireEvent.pointerEnter(camera, { pointerType: "mouse" });
    expect(region).not.toHaveAttribute("data-chapter-still");
    const enteringPose = (camera as HTMLElement).style.transform;
    fireEvent.pointerMove(resume, { pointerType: "mouse" });
    expect(region).not.toHaveAttribute("data-chapter-still");
    expect((camera as HTMLElement).style.transform).toBe(enteringPose);
    fireEvent.pointerLeave(camera, { pointerType: "mouse" });
    expect(region).not.toHaveAttribute("data-chapter-still");

    act(() => resume.focus());
    expect(region).toHaveAttribute("data-chapter-still", "true");
    expect((camera as HTMLElement).style.transform).toBe(enteringPose);
    act(() => scroll.current!.set(0.65));
    expect((camera as HTMLElement).style.transform).toBe(enteringPose);
    act(() => letter.focus());
    expect(region).toHaveAttribute("data-chapter-still", "true");
    expect(letter).toHaveFocus();
    act(() => screen.getByRole("button", { name: "Continue outside" }).focus());
    expect(region).not.toHaveAttribute("data-chapter-still");
  });

  it("pauses all layer transforms without changing chapter size or mounted content", () => {
    const content = <ScrollChapter labelledBy="pause-heading"><h2 id="pause-heading">Pause example</h2><DepthLayer><button>Keep my place</button></DepthLayer></ScrollChapter>;
    const { rerender } = render(<LandingMotionProvider paused={false}>{content}</LandingMotionProvider>);
    const region = screen.getByRole("region", { name: "Pause example" });
    const button = screen.getByRole("button", { name: "Keep my place" });
    button.focus();
    expect(region).toHaveAttribute("data-chapter-layout", "screen");
    rerender(<LandingMotionProvider paused>{content}</LandingMotionProvider>);

    expect(region).toHaveAttribute("data-chapter-layout", "screen");
    expect(region).toHaveAttribute("data-chapter-still", "true");
    expect(button.parentElement).toHaveStyle({ transform: "none" });
    expect(button).toHaveFocus();
  });
});
