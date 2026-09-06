import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { MotionValue } from "framer-motion";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../messages/en.json";
import { ImmersiveLanding } from "./ImmersiveLanding";

const runtime = vi.hoisted(() => ({
  theme: "light",
  scroll: null as MotionValue<number> | null,
  scene: vi.fn((_props: { dark: boolean; progress: MotionValue<number>; paused: boolean; onReady: () => void }) => null),
}));
// Observe the heavy-module boundary without creating a WebGL context in jsdom.
vi.mock("next/dynamic", () => ({
  default: () => function SceneProbe(props: Parameters<typeof runtime.scene>[0]) {
    runtime.scene(props);
    return <div data-testid="workstation-scene" />;
  },
}));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null, status: "unauthenticated" }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: runtime.theme, setTheme: vi.fn() }) }));
vi.mock("framer-motion", async (original) => {
  const actual = await original<typeof import("framer-motion")>();
  return {
    ...actual,
    // Exercise scene-target wiring; spring interpolation belongs to Framer.
    useSpring: (source: MotionValue<number>) => source,
    useScroll: () => {
      const value = actual.useMotionValue(0);
      runtime.scroll ??= value;
      return { scrollYProgress: value };
    },
  };
});

const observations: { target: Element; callback: IntersectionObserverCallback }[] = [];
const hiddenDescriptor = Object.getOwnPropertyDescriptor(document, "hidden");
const originalMatchMedia = window.matchMedia;
let motionQuery: EventTarget & { matches: boolean };
let layoutQuery: EventTarget & { matches: boolean };

function reducedMotion(enabled: boolean) {
  motionQuery.matches = enabled;
  motionQuery.dispatchEvent(new Event("change"));
}

function sceneVisibility(visible: boolean) {
  const observed = observations.find(({ target }) => target.getAttribute("aria-labelledby") === "landing-title");
  if (!observed) throw new Error("The scene visibility boundary was not observed");
  observed.callback([{ isIntersecting: visible, target: observed.target } as IntersectionObserverEntry], {} as IntersectionObserver);
}

function pageVisibility(visible: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, value: !visible });
  document.dispatchEvent(new Event("visibilitychange"));
}

function renderLanding() {
  return render(<NextIntlClientProvider locale="en" messages={messages}><ImmersiveLanding /></NextIntlClientProvider>);
}

describe("ImmersiveLanding motion lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    runtime.theme = "light";
    runtime.scroll = null;
    motionQuery = Object.assign(new EventTarget(), { matches: false });
    layoutQuery = Object.assign(new EventTarget(), { matches: true });
    window.matchMedia = query => (query.includes("min-width: 960px") ? layoutQuery : motionQuery) as MediaQueryList;
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    runtime.scene.mockClear();
    observations.length = 0;
    pageVisibility(true);
    vi.stubGlobal("IntersectionObserver", class {
      constructor(private callback: IntersectionObserverCallback) {}
      observe(target: Element) { observations.push({ target, callback: this.callback }); }
      unobserve() {}
      disconnect() {}
    });
  });
  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.matchMedia = originalMatchMedia;
    if (hiddenDescriptor) Object.defineProperty(document, "hidden", hiddenDescriptor);
    else Reflect.deleteProperty(document, "hidden");
  });

  it("waits for the scene to enter view, cancels startup on leaving, and keeps a pause control in navigation", () => {
    renderLanding();
    act(() => vi.advanceTimersByTime(1000));
    expect(runtime.scene).not.toHaveBeenCalled();
    // A restored deep link can animate later chapters without loading WebGL.
    const pause = screen.getByRole("button", { name: messages.landingExperience.hero.pause });
    fireEvent.click(pause);
    expect(document.getElementById("features")).toHaveAttribute("data-chapter-still", "true");
    fireEvent.click(screen.getByRole("button", { name: messages.landingExperience.hero.resume }));
    act(() => sceneVisibility(true));
    act(() => vi.advanceTimersByTime(200));
    act(() => sceneVisibility(false));
    act(() => vi.advanceTimersByTime(1000));
    expect(runtime.scene).not.toHaveBeenCalled();
    act(() => sceneVisibility(true));
    act(() => vi.advanceTimersByTime(250));
    expect(runtime.scene).toHaveBeenCalled();
    act(() => runtime.scene.mock.lastCall![0].onReady());
    const navigation = screen.getByRole("navigation", { name: messages.landingExperience.nav.primary });
    fireEvent.click(within(navigation).getByRole("button", { name: messages.landingExperience.hero.pause }));
    expect(runtime.scene.mock.lastCall![0].paused).toBe(true);
    expect(within(navigation).getByRole("button", { name: messages.landingExperience.hero.resume })).toHaveAttribute("aria-pressed", "true");
    act(() => sceneVisibility(false));
    expect(runtime.scene.mock.lastCall![0].paused).toBe(true);
  });

  it("keeps readable content without mounting the 3D scene for reduced motion", () => {
    reducedMotion(true);
    renderLanding();
    act(() => sceneVisibility(true));
    act(() => vi.advanceTimersByTime(1000));
    expect(runtime.scene).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Interactive product demo" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: messages.landingExperience.hero.pause })).not.toBeInTheDocument();
  });

  it("unmounts and restores 3D immediately when the motion preference changes without a reload", () => {
    renderLanding();
    act(() => sceneVisibility(true));
    act(() => vi.advanceTimersByTime(250));
    expect(screen.getByTestId("workstation-scene")).toBeInTheDocument();
    act(() => runtime.scene.mock.lastCall![0].onReady());
    act(() => reducedMotion(true));
    expect(screen.queryByTestId("workstation-scene")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: messages.landingExperience.hero.pause })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    act(() => reducedMotion(false));
    expect(screen.getByTestId("workstation-scene")).toBeInTheDocument();
    expect(runtime.scene.mock.lastCall![0].paused).toBe(false);
    expect(screen.getByRole("heading", { level: 1 }).closest("section")).toHaveAttribute("data-scene-state", "loading");
    expect(screen.getByRole("button", { name: messages.landingExperience.hero.pause })).toBeInTheDocument();
    act(() => runtime.scene.mock.lastCall![0].onReady());
    expect(screen.getByRole("heading", { level: 1 }).closest("section")).toHaveAttribute("data-scene-state", "ready");
  });

  it("defers startup in a background tab and pauses the mounted scene when it becomes hidden", () => {
    pageVisibility(false);
    renderLanding();
    act(() => sceneVisibility(true));
    act(() => vi.advanceTimersByTime(1000));
    expect(runtime.scene).not.toHaveBeenCalled();
    act(() => pageVisibility(true));
    act(() => vi.advanceTimersByTime(250));
    expect(runtime.scene.mock.lastCall![0].paused).toBe(false);
    act(() => pageVisibility(false));
    expect(runtime.scene.mock.lastCall![0].paused).toBe(true);
  });

  it("updates scene materials with the theme without remounting or restarting its ready canvas", () => {
    const { rerender } = renderLanding();
    act(() => sceneVisibility(true));
    act(() => vi.advanceTimersByTime(250));
    act(() => runtime.scene.mock.lastCall![0].onReady());
    const canvasBoundary = screen.getByTestId("workstation-scene");
    expect(runtime.scene.mock.lastCall![0].dark).toBe(false);
    for (const theme of ["dark", "light"]) {
      runtime.theme = theme;
      rerender(<NextIntlClientProvider locale="en" messages={messages}><ImmersiveLanding /></NextIntlClientProvider>);
      expect(runtime.scene.mock.lastCall![0].dark).toBe(theme === "dark");
      expect(screen.getByTestId("workstation-scene")).toBe(canvasBoundary);
      expect(screen.getByRole("heading", { level: 1 }).closest("section")).toHaveAttribute("data-scene-state", "ready");
    }
  });

  it("navigates chapters on the native timeline and keeps the text and scene aligned in both directions", () => {
    renderLanding();
    act(() => sceneVisibility(true));
    act(() => vi.advanceTimersByTime(250));
    const workflow = document.getElementById("workflow")!;
    vi.spyOn(workflow, "getBoundingClientRect").mockReturnValue({ top: 800, height: 2720 } as DOMRect);
    const steps = within(workflow).getAllByRole("button");
    fireEvent.click(steps[2]);
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 800 + (2720 - window.innerHeight) * .92, behavior: "smooth" });
    // Selecting a destination does not jump the scene ahead of the scroll.
    expect(runtime.scene.mock.lastCall![0].progress.get()).toBe(0);
    act(() => runtime.scroll!.set(.92));
    expect(steps[2]).toHaveAttribute("aria-current", "step");
    expect(runtime.scene.mock.lastCall![0].progress.get()).toBe(1);
    act(() => runtime.scroll!.set(.5));
    expect(steps[1]).toHaveAttribute("aria-current", "step");
    expect(runtime.scene.mock.lastCall![0].progress.get()).toBe(.5);
    act(() => runtime.scroll!.set(.1));
    expect(steps[0]).toHaveAttribute("aria-current", "step");
    expect(runtime.scene.mock.lastCall![0].progress.get()).toBe(0);
    fireEvent.click(steps[0]);
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 800 + (2720 - window.innerHeight) * .08, behavior: "smooth" });
  });

  it("switches to readable flow on narrow or short screens and restores the current scroll scene when enlarged", () => {
    renderLanding();
    act(() => sceneVisibility(true));
    act(() => vi.advanceTimersByTime(250));
    act(() => runtime.scroll!.set(.5));
    const journey = screen.getByRole("heading", { level: 1 }).closest("section")!;
    expect(journey).toHaveAttribute("data-layout", "cinematic");
    act(() => { layoutQuery.matches = false; layoutQuery.dispatchEvent(new Event("change")); });
    expect(journey).toHaveAttribute("data-layout", "flow");
    const workflow = document.getElementById("workflow")!;
    for (const step of messages.landingExperience.story.steps) {
      expect(within(workflow).getByRole("heading", { name: step.title })).toBeVisible();
    }
    act(() => { layoutQuery.matches = true; layoutQuery.dispatchEvent(new Event("change")); });
    expect(journey).toHaveAttribute("data-layout", "cinematic");
    expect(runtime.scene.mock.lastCall![0].progress.get()).toBe(.5);
  });
});
