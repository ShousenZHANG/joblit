import { act, cleanup, render, screen } from "@testing-library/react";
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
  let desktop = true;
  let reduced = false;

  beforeEach(() => {
    scroll.current!.set(0.5);
    desktop = true;
    reduced = false;
    vi.spyOn(window, "matchMedia").mockImplementation(query => ({
      matches: query.includes("prefers-reduced-motion") ? reduced : desktop,
      media: query,
      onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    }));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function chapter(closing = false) {
    return render(<>
      <ScrollChapter id="features" labelledBy="feature-heading" closing={closing}>
        <h2 id="feature-heading">Your experience</h2>
        <DepthLayer depth={1.2}><figure>Resume preview</figure></DepthLayer>
        <button type="button">Open cover letter</button>
      </ScrollChapter>
      <button type="button">Continue outside</button>
    </>);
  }

  const layer = () => screen.getByText("Resume preview").parentElement as HTMLElement;
  // Framer Motion applies style updates on its own animation frame, not during React's render.
  const nextFrame = () => act(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

  it("keeps a labelled chapter in document flow without hiding content or intercepting native scrolling", () => {
    chapter();
    const region = screen.getByRole("region", { name: "Your experience" });
    expect(region).toHaveAttribute("id", "features");
    expect(region).toHaveAttribute("data-scroll-chapter");
    expect(region).not.toHaveAttribute("data-chapter-still");
    expect(region.querySelector("[aria-hidden], [inert]")).toBeNull();
    expect(screen.getByRole("button", { name: "Open cover letter" })).toBeVisible();
    const wheel = new WheelEvent("wheel", { deltaY: 320, bubbles: true, cancelable: true });
    expect(region.dispatchEvent(wheel)).toBe(true);
    expect(wheel.defaultPrevented).toBe(false);
  });

  it("never transforms the chapter's own text", () => {
    scroll.current!.set(0.1);
    chapter();
    const heading = screen.getByRole("heading", { name: "Your experience" });
    for (let node: HTMLElement | null = heading; node && node.tagName !== "SECTION"; node = node.parentElement) {
      expect(node.style.transform).toBe("");
    }
  });

  it("drifts decorative layers by translation only, resting when the chapter is centred", async () => {
    scroll.current!.set(0.1);
    chapter();
    const entering = layer().style.transform;
    expect(entering).toMatch(/translateY\(/);
    expect(entering).not.toMatch(/rotate|scale|perspective|translateZ|translate3d/);

    act(() => scroll.current!.set(0.5));
    await nextFrame();
    expect(layer().style.transform).toMatch(/^(none|translateY\(0px\))?$/);

    act(() => scroll.current!.set(0.9));
    await nextFrame();
    expect(layer().style.transform).toMatch(/translateY\(-/);
  });

  it("keeps the closing chapter's layers at rest as the page ends", () => {
    scroll.current!.set(0.95);
    chapter(true);
    expect(screen.getByRole("region", { name: "Your experience" })).toHaveAttribute("data-chapter-closing", "true");
    expect(layer().style.transform).not.toMatch(/translateY\(-/);
  });

  it.each(["small screen", "reduced motion"])("holds every layer still for %s", mode => {
    if (mode === "small screen") desktop = false;
    else reduced = true;
    scroll.current!.set(0.1);
    chapter();
    const region = screen.getByRole("region", { name: "Your experience" });
    expect(region).toHaveAttribute("data-chapter-still", "true");
    expect(layer()).toHaveStyle({ transform: "none" });
  });

  it("pauses layer motion without changing mounted content or focus", async () => {
    scroll.current!.set(0.1);
    const content = <ScrollChapter labelledBy="pause-heading"><h2 id="pause-heading">Pause example</h2><DepthLayer><figure>Illustration</figure></DepthLayer><button>Keep my place</button></ScrollChapter>;
    const { rerender } = render(<LandingMotionProvider paused={false}>{content}</LandingMotionProvider>);
    const region = screen.getByRole("region", { name: "Pause example" });
    const button = screen.getByRole("button", { name: "Keep my place" });
    button.focus();
    expect(region).not.toHaveAttribute("data-chapter-still");

    rerender(<LandingMotionProvider paused>{content}</LandingMotionProvider>);
    expect(region).toHaveAttribute("data-chapter-still", "true");
    await nextFrame();
    expect(screen.getByText("Illustration").parentElement).toHaveStyle({ transform: "none" });
    expect(button).toHaveFocus();
  });
});
