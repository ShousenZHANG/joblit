import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import zh from "@/messages/zh.json";
import { PageChapterNav } from "./PageChapterNav";

const ids = ["overview", "workflow", "demo", "features", "documents", "organise", "get-started", "faq", "start"];
const originalMatchMedia = window.matchMedia;
let frameCallback: FrameRequestCallback | undefined;
let resizeCallback: ResizeObserverCallback;
let scrollTop = 0;
let positions: number[];
let main: HTMLElement;

function flushMeasurement() {
  act(() => {
    const callback = frameCallback;
    frameCallback = undefined;
    callback?.(0);
  });
}

function renderRail(locale: "en" | "zh" = "en") {
  const messages = locale === "en" ? en : zh;
  render(<NextIntlClientProvider locale={locale} messages={messages}><PageChapterNav /></NextIntlClientProvider>);
  flushMeasurement();
  return within(screen.getByRole("navigation", { name: messages.landingExperience.pageNavigation.label }));
}

describe("PageChapterNav", () => {
  beforeEach(() => {
    scrollTop = 0;
    positions = [0, 1000, 4400, 5400, 6400, 7400, 8400, 9400, 10000];
    frameCallback = undefined;
    vi.stubGlobal("innerHeight", 900);
    vi.stubGlobal("scrollY", 0);
    vi.spyOn(document.documentElement, "scrollHeight", "get").mockReturnValue(10500);
    window.matchMedia = vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as MediaQueryList);
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { frameCallback = callback; return 1; }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: ResizeObserverCallback) { resizeCallback = callback; }
      observe = vi.fn();
      disconnect = vi.fn();
    });
    main = document.createElement("main");
    main.id = "main-content";
    ids.forEach((id, index) => {
      const section = document.createElement("section");
      section.id = id;
      vi.spyOn(section, "getBoundingClientRect").mockImplementation(() => ({ top: positions[index] - scrollTop }) as DOMRect);
      main.append(section);
    });
    document.body.append(main);
  });

  afterEach(() => {
    cleanup();
    main?.remove();
    window.matchMedia = originalMatchMedia;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each(["en", "zh"] as const)("provides labelled native anchor links in %s", locale => {
    const rail = renderRail(locale);
    const links = rail.getAllByRole("link");
    expect(links).toHaveLength(ids.length);
    links.forEach((link, index) => {
      expect(link).toHaveAttribute("href", `#${ids[index]}`);
      expect(link).toHaveAccessibleName();
    });
    expect(links[0]).toHaveAttribute("aria-current", "location");
    expect(links.filter(link => link.hasAttribute("aria-current"))).toHaveLength(1);
  });

  it("follows forward and reverse scrolling and keeps the long workflow as one chapter", () => {
    const rail = renderRail();
    const raf = vi.mocked(window.requestAnimationFrame);
    raf.mockClear();
    scrollTop = 3000;
    vi.stubGlobal("scrollY", scrollTop);
    fireEvent.scroll(window);
    fireEvent.scroll(window);
    fireEvent.scroll(window);
    expect(raf).toHaveBeenCalledTimes(1);
    flushMeasurement();
    expect(rail.getByRole("link", { name: "How it works" })).toHaveAttribute("aria-current", "location");

    scrollTop = 600;
    vi.stubGlobal("scrollY", scrollTop);
    fireEvent.scroll(window);
    flushMeasurement();
    expect(rail.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "location");
  });

  it("remeasures expanded content without scrolling and recognises a short final chapter at the page end", () => {
    const rail = renderRail();
    scrollTop = 5500;
    vi.stubGlobal("scrollY", scrollTop);
    fireEvent.scroll(window);
    flushMeasurement();
    expect(rail.getByRole("link", { name: "Discover opportunities" })).toHaveAttribute("aria-current", "location");

    positions[3] = 6100;
    act(() => resizeCallback([], {} as ResizeObserver));
    flushMeasurement();
    expect(rail.getByRole("link", { name: "Try the demo" })).toHaveAttribute("aria-current", "location");

    scrollTop = 9600;
    vi.stubGlobal("scrollY", scrollTop);
    fireEvent.scroll(window);
    flushMeasurement();
    expect(rail.getByRole("link", { name: "Get started" })).toHaveAttribute("aria-current", "location");
  });
});
