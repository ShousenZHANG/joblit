import "@testing-library/jest-dom/vitest";

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
