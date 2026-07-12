import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RouteTransition } from "./RouteTransition";

let mockPathname = "/jobs";
const capturedMotionProps: Record<string, unknown>[] = [];

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

vi.mock("framer-motion", () => ({
  motion: {
    div: ({
      children,
      ...props
    }: {
      children: React.ReactNode;
      [key: string]: unknown;
    }) => {
      capturedMotionProps.push(props);
      const { initial, animate, transition, exit, ...domProps } = props;
      void initial;
      void animate;
      void transition;
      void exit;

      return (
        <div {...(domProps as React.ComponentProps<"div">)}>{children}</div>
      );
    },
  },
  useReducedMotion: () => false,
}));

describe("RouteTransition", () => {
  let focusMock: ReturnType<typeof vi.spyOn>;
  let appShellScrollMock: ReturnType<typeof vi.spyOn>;
  let windowScrollMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockPathname = "/jobs";
    capturedMotionProps.length = 0;
    windowScrollMock = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    focusMock = vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(() => {});
    appShellScrollMock = vi
      .spyOn(HTMLElement.prototype, "scrollTo")
      .mockImplementation(() => {});
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows the first render immediately", () => {
    render(
      <RouteTransition>
        <div>Content</div>
      </RouteTransition>,
    );

    expect(capturedMotionProps.at(-1)?.initial).toBe(false);
  });

  it("animates a later forward route without scaling the page", () => {
    const view = render(
      <RouteTransition>
        <div>Jobs</div>
      </RouteTransition>,
    );

    mockPathname = "/resume";
    view.rerender(
      <RouteTransition>
        <div>Resume</div>
      </RouteTransition>,
    );

    expect(capturedMotionProps.at(-1)?.initial).toEqual({ opacity: 0, y: 4 });
    expect(capturedMotionProps.at(-1)?.animate).toEqual({ opacity: 1, y: 0 });
    expect(capturedMotionProps.at(-1)?.exit).toBeUndefined();
  });

  it("focuses main content after a later forward route without forcing scroll", () => {
    const view = render(
      <div className="app-shell">
        <main id="main-content" tabIndex={-1}>
          <RouteTransition>
            <div>Jobs</div>
          </RouteTransition>
        </main>
      </div>,
    );

    focusMock.mockClear();
    appShellScrollMock.mockClear();
    windowScrollMock.mockClear();
    mockPathname = "/resume";
    view.rerender(
      <div className="app-shell">
        <main id="main-content" tabIndex={-1}>
          <RouteTransition>
            <div>Resume</div>
          </RouteTransition>
        </main>
      </div>,
    );

    expect(focusMock).toHaveBeenCalledOnce();
    expect(focusMock).toHaveBeenCalledWith({ preventScroll: true });
    expect(windowScrollMock).not.toHaveBeenCalled();
    expect(appShellScrollMock).not.toHaveBeenCalled();
  });

  it("does not focus or scroll after browser history navigation", () => {
    const view = render(
      <div className="app-shell">
        <main id="main-content" tabIndex={-1}>
          <RouteTransition>
            <div>Jobs</div>
          </RouteTransition>
        </main>
      </div>,
    );

    focusMock.mockClear();
    appShellScrollMock.mockClear();
    windowScrollMock.mockClear();
    act(() => window.dispatchEvent(new PopStateEvent("popstate")));
    mockPathname = "/resume";
    view.rerender(
      <div className="app-shell">
        <main id="main-content" tabIndex={-1}>
          <RouteTransition>
            <div>Resume</div>
          </RouteTransition>
        </main>
      </div>,
    );

    expect(capturedMotionProps.at(-1)?.initial).toBe(false);
    expect(focusMock).not.toHaveBeenCalled();
    expect(windowScrollMock).not.toHaveBeenCalled();
    expect(appShellScrollMock).not.toHaveBeenCalled();
  });
});
