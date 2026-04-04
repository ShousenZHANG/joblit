import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { cleanup, render, screen, fireEvent, act } from "@testing-library/react";
import LegalTableOfContents from "./LegalTableOfContents";

const MOCK_ITEMS = [
  { id: "section-1", label: "1. First Section" },
  { id: "section-2", label: "2. Second Section" },
  { id: "section-3", label: "3. Third Section" },
];

// Mock IntersectionObserver
const mockObserve = vi.fn();
const mockDisconnect = vi.fn();
let ioCallback: (entries: Array<{ isIntersecting: boolean; target: Element }>) => void;

beforeEach(() => {
  mockObserve.mockClear();
  mockDisconnect.mockClear();

  class MockIntersectionObserver {
    constructor(callback: typeof ioCallback, _options?: IntersectionObserverInit) {
      ioCallback = callback;
    }
    observe = mockObserve;
    disconnect = mockDisconnect;
    unobserve = vi.fn();
  }

  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
});

afterEach(cleanup);

describe("LegalTableOfContents", () => {
  it("renders all TOC items as buttons in the desktop sidebar", () => {
    render(<LegalTableOfContents items={MOCK_ITEMS} />);

    // Desktop sidebar renders the heading
    expect(screen.getByText("On this page")).toBeInTheDocument();

    // Each label appears twice: once in desktop nav, once in mobile toggle area
    // (mobile list is hidden until toggled)
    const buttons = screen.getAllByRole("button", { name: "1. First Section" });
    expect(buttons.length).toBeGreaterThanOrEqual(1);

    expect(screen.getAllByRole("button", { name: "2. Second Section" }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole("button", { name: "3. Third Section" }).length).toBeGreaterThanOrEqual(1);
  });

  it("renders the mobile toggle button", () => {
    render(<LegalTableOfContents items={MOCK_ITEMS} />);

    const toggle = screen.getByRole("button", { name: /Table of Contents/i });
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("toggles mobile list open and closed", () => {
    render(<LegalTableOfContents items={MOCK_ITEMS} />);

    const toggle = screen.getByRole("button", { name: /Table of Contents/i });

    // Initially mobile list is not shown (items only appear in desktop nav)
    const initialButtons = screen.getAllByRole("button", { name: "1. First Section" });
    const initialCount = initialButtons.length;

    // Open mobile list
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    // Now mobile list items should also be rendered
    const afterOpenButtons = screen.getAllByRole("button", { name: "1. First Section" });
    expect(afterOpenButtons.length).toBe(initialCount + 1);

    // Close mobile list
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    const afterCloseButtons = screen.getAllByRole("button", { name: "1. First Section" });
    expect(afterCloseButtons.length).toBe(initialCount);
  });

  it("sets up IntersectionObserver on mount", () => {
    // Create mock DOM elements for the items
    for (const item of MOCK_ITEMS) {
      const el = document.createElement("div");
      el.id = item.id;
      document.body.appendChild(el);
    }

    render(<LegalTableOfContents items={MOCK_ITEMS} />);

    // IO was constructed and observe was called for each element
    expect(mockObserve).toHaveBeenCalledTimes(3);

    // Clean up DOM
    for (const item of MOCK_ITEMS) {
      document.getElementById(item.id)?.remove();
    }
  });

  it("disconnects IntersectionObserver on unmount", () => {
    const { unmount } = render(<LegalTableOfContents items={MOCK_ITEMS} />);

    unmount();
    expect(mockDisconnect).toHaveBeenCalled();
  });

  it("calls scrollIntoView when a TOC item is clicked", () => {
    const mockScrollIntoView = vi.fn();
    const el = document.createElement("div");
    el.id = "section-1";
    el.scrollIntoView = mockScrollIntoView;
    document.body.appendChild(el);

    render(<LegalTableOfContents items={MOCK_ITEMS} />);

    // Click the first desktop TOC item
    const buttons = screen.getAllByRole("button", { name: "1. First Section" });
    fireEvent.click(buttons[0]);

    expect(mockScrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "start",
    });

    el.remove();
  });

  it("closes mobile menu when a TOC item is clicked", () => {
    const el = document.createElement("div");
    el.id = "section-1";
    el.scrollIntoView = vi.fn();
    document.body.appendChild(el);

    render(<LegalTableOfContents items={MOCK_ITEMS} />);

    // Open mobile menu
    const toggle = screen.getByRole("button", { name: /Table of Contents/i });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    // Click a mobile list item (last instance is the mobile one)
    const buttons = screen.getAllByRole("button", { name: "1. First Section" });
    fireEvent.click(buttons[buttons.length - 1]);

    // Mobile menu should be closed
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    el.remove();
  });

  it("applies active class when IntersectionObserver fires", () => {
    const el = document.createElement("div");
    el.id = "section-2";
    document.body.appendChild(el);

    render(<LegalTableOfContents items={MOCK_ITEMS} />);

    // Simulate intersection via the captured callback (wrapped in act for state update)
    act(() => {
      ioCallback([{ isIntersecting: true, target: el }]);
    });

    // The button for section-2 should have the active class
    const buttons = screen.getAllByRole("button", { name: "2. Second Section" });
    const hasActive = buttons.some((btn) => btn.className.includes("legal-toc-link--active"));
    expect(hasActive).toBe(true);

    // section-1 should NOT have active class
    const s1Buttons = screen.getAllByRole("button", { name: "1. First Section" });
    const s1Active = s1Buttons.some((btn) => btn.className.includes("legal-toc-link--active"));
    expect(s1Active).toBe(false);

    el.remove();
  });
});
