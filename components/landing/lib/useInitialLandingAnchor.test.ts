import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useInitialLandingAnchor } from "./useInitialLandingAnchor";

describe("initial landing fragment alignment", () => {
  let resized: () => void;
  const disconnect = vi.fn();
  const observe = vi.fn();
  let scroll: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    disconnect.mockClear();
    observe.mockClear();
    document.body.innerHTML = '<main id="main-content"><section id="features"></section><section id="faq"><button>Question</button></section></main>';
    window.history.replaceState(null, "", "/#faq");
    scroll = vi.spyOn(Element.prototype, "scrollIntoView");
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) { resized = callback; }
      observe = observe;
      disconnect = disconnect;
    });
    Object.defineProperty(document, "fonts", { configurable: true, value: { status: "loaded", ready: Promise.resolve() } });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(document, "fonts");
    document.body.innerHTML = "";
    window.history.replaceState(null, "", "/");
  });

  it("waits for repeated hydration resizes to settle, then corrects only once without changing focus or history", () => {
    const history = vi.spyOn(window.history, "replaceState");
    const button = document.querySelector("button")!;
    button.focus();
    renderHook(useInitialLandingAnchor);
    act(() => { vi.advanceTimersByTime(150); resized(); });
    act(() => { vi.advanceTimersByTime(150); resized(); });
    expect(scroll).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(180));
    expect(scroll).toHaveBeenCalledExactlyOnceWith({ behavior: "instant", block: "start", inline: "nearest" });
    expect(scroll.mock.instances[0]).toBe(document.getElementById("faq"));
    expect(document.activeElement).toBe(button);
    expect(window.location.hash).toBe("#faq");
    expect(history).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalledOnce();

    act(() => { resized(); vi.advanceTimersByTime(3000); });
    expect(scroll).toHaveBeenCalledOnce();
  });

  it.each(["wheel", "touchstart", "pointerdown", "keydown", "hashchange"])("cancels pending correction when %s starts", event => {
    renderHook(useInitialLandingAnchor);
    act(() => window.dispatchEvent(new Event(event)));
    act(() => { resized(); vi.advanceTimersByTime(3000); });
    expect(scroll).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalled();
  });

  it.each(["#missing", "#%E0%A4%A", "#main-content", ""])("leaves unknown or invalid fragment %s to the browser", hash => {
    window.history.replaceState(null, "", `/${hash}`);
    renderHook(useInitialLandingAnchor);
    act(() => vi.advanceTimersByTime(3000));
    expect(observe).not.toHaveBeenCalled();
    expect(scroll).not.toHaveBeenCalled();
  });

  it("waits for fonts and cancels all pending work when unmounted", async () => {
    let resolveFonts: () => void = () => {};
    Object.defineProperty(document, "fonts", { configurable: true, value: {
      status: "loading", ready: new Promise<void>(resolve => { resolveFonts = resolve; }),
    } });
    const { unmount } = renderHook(useInitialLandingAnchor);
    act(() => vi.advanceTimersByTime(400));
    expect(scroll).not.toHaveBeenCalled();
    await act(async () => resolveFonts());
    act(() => vi.advanceTimersByTime(100));
    expect(scroll).not.toHaveBeenCalled();
    unmount();
    act(() => vi.advanceTimersByTime(3000));
    expect(scroll).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalled();
  });

  it("bounds the correction window even if layout never becomes quiet", () => {
    renderHook(useInitialLandingAnchor);
    for (let i = 0; i < 12; i++) act(() => { vi.advanceTimersByTime(150); resized(); });
    expect(scroll).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
