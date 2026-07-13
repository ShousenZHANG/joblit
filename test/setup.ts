import "@testing-library/jest-dom/vitest";
import type { AxeMatchers } from "vitest-axe";
import { expect } from "vitest";
import * as axeMatchers from "vitest-axe/matchers";

type VitestAssertionDefault = ReturnType<JSON["parse"]>;

// vitest-axe@0.1 augments the removed Vitest `Vi` namespace. Vitest 4 exposes
// matcher types through the `vitest` module, so bridge the package's matcher
// contract into the current assertion interfaces.
declare module "vitest" {
  interface Assertion<T = VitestAssertionDefault> {
    toHaveNoViolations(
      this: Assertion<T>,
    ): ReturnType<AxeMatchers["toHaveNoViolations"]>;
  }
  interface AsymmetricMatchersContaining {
    toHaveNoViolations(): ReturnType<AxeMatchers["toHaveNoViolations"]>;
  }
}

// Accessibility assertions: enables `expect(container).toHaveNoViolations()`
// backed by axe-core. Complements the per-PR Lighthouse accessibility gate
// (>=0.95) with component-level checks that catch interactive-state issues.
expect.extend(axeMatchers);

// jsdom intentionally leaves canvas rendering unimplemented. axe-core uses a
// tiny 2D surface only to compare text widths/pixels when detecting icon-font
// ligatures, so provide that deterministic subset instead of suppressing the
// resulting console errors (which could hide real application failures).
Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
  configurable: true,
  value(this: HTMLCanvasElement, contextId: string) {
    if (contextId !== "2d") return null;

    return {
      canvas: this,
      font: "10px sans-serif",
      textAlign: "start",
      textBaseline: "alphabetic",
      measureText(text: string) {
        return { width: text.length * 10 } as TextMetrics;
      },
      fillText() {},
      clearRect() {},
      getImageData(_x: number, _y: number, width: number, height: number) {
        const data = new Uint8ClampedArray(
          Math.max(1, Math.ceil(width)) * Math.max(1, Math.ceil(height)) * 4,
        );
        data[3] = 255;
        return { data } as ImageData;
      },
    } as unknown as CanvasRenderingContext2D;
  },
});

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (!("ResizeObserver" in globalThis)) {
  (
    globalThis as typeof globalThis & {
      ResizeObserver: typeof ResizeObserverMock;
    }
  ).ResizeObserver = ResizeObserverMock;
}

class IntersectionObserverMock {
  readonly root = null;
  readonly rootMargin = "0px";
  readonly thresholds: readonly number[] = [0];
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

if (!("IntersectionObserver" in globalThis)) {
  (
    globalThis as typeof globalThis & {
      IntersectionObserver: typeof IntersectionObserverMock;
    }
  ).IntersectionObserver = IntersectionObserverMock;
}

class DOMMatrixMock {
  constructor(_init?: string | number[]) {}
}

if (!("DOMMatrix" in globalThis)) {
  Object.defineProperty(globalThis, "DOMMatrix", {
    configurable: true,
    writable: true,
    value: DOMMatrixMock,
  });
}

Object.defineProperty(window, "scrollTo", {
  value: () => {},
  writable: true,
});

// jsdom does not implement Element.scrollTo
if (!Element.prototype.scrollTo) {
  (
    Element.prototype as Element & {
      scrollTo: (options?: ScrollToOptions) => void;
    }
  ).scrollTo = () => {};
}

// jsdom does not implement Element.scrollIntoView
if (!Element.prototype.scrollIntoView) {
  (
    Element.prototype as Element & {
      scrollIntoView: (arg?: boolean | ScrollIntoViewOptions) => void;
    }
  ).scrollIntoView = () => {};
}

Object.defineProperty(window, "matchMedia", {
  value: () => ({
    matches: false,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
  writable: true,
});
