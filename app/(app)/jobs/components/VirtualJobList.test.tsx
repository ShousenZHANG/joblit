import { useCallback, useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import messages from "../../../../messages/en.json";
import type { JobItem } from "../types";
import { useKeyboardNavigation } from "../hooks/useKeyboardNavigation";
import { VirtualJobList, type VirtualJobListHandle } from "./VirtualJobList";

type MockRange = {
  startIndex: number;
  endIndex: number;
  overscan: number;
  count: number;
};

type MockVirtualizerOptions = {
  count: number;
  estimateSize: () => number;
  measureElement?: (element: HTMLElement) => number;
  rangeExtractor?: (range: MockRange) => number[];
};

const virtualMock = vi.hoisted(() => ({
  estimatedSize: 0,
  isScrolling: false,
  reducedMotion: false,
  startIndex: 0,
  endIndex: 1,
  measureElement: vi.fn(),
  order: [] as string[],
  scrollToIndex: vi.fn(),
}));

vi.mock("framer-motion", () => ({
  useReducedMotion: () => virtualMock.reducedMotion,
}));

vi.mock("@tanstack/react-virtual", async () => {
  const React = await import("react");
  const defaultRangeExtractor = (range: MockRange) => {
    const indexes: number[] = [];
    for (let index = range.startIndex; index <= range.endIndex; index += 1) {
      indexes.push(index);
    }
    return indexes;
  };

  return {
    defaultRangeExtractor,
    useVirtualizer(options: MockVirtualizerOptions) {
      const [, forceRender] = React.useReducer((revision: number) => revision + 1, 0);
      const estimatedSize = options.estimateSize();
      virtualMock.estimatedSize = estimatedSize;
      const range = {
        startIndex: virtualMock.startIndex,
        endIndex: virtualMock.endIndex,
        overscan: 0,
        count: options.count,
      };
      const indexes = (options.rangeExtractor ?? defaultRangeExtractor)(range);

      return {
        isScrolling: virtualMock.isScrolling,
        getTotalSize: () => options.count * estimatedSize,
        getVirtualItems: () => indexes.map((index) => ({
          key: index,
          index,
          start: index * estimatedSize,
          end: (index + 1) * estimatedSize,
          size: estimatedSize,
          lane: 0,
        })),
        measureElement(element: HTMLElement | null) {
          if (!element) return;
          virtualMock.measureElement(element);
          options.measureElement?.(element);
        },
        scrollToIndex(index: number, scrollOptions?: { align?: string }) {
          virtualMock.order.push(`scroll:${index}`);
          virtualMock.scrollToIndex(index, scrollOptions);
          virtualMock.startIndex = index;
          virtualMock.endIndex = index;
          forceRender();
        },
      };
    },
  };
});

const now = new Date().toISOString();
function makeJobs(
  count: number,
  overrides: (index: number) => Partial<JobItem> = () => ({}),
): JobItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `virtual-${index}`,
    jobUrl: `https://example.com/jobs/${index}`,
    title: `Virtual role ${index}`,
    company: "Virtual Co",
    location: "Remote",
    jobType: "Full-time",
    jobLevel: "Mid",
    status: "NEW",
    createdAt: now,
    updatedAt: now,
    ...overrides(index),
  }));
}

const virtualJobs = makeJobs(12);

function VirtualListHarness({
  selectedId,
  items = virtualJobs,
}: {
  selectedId: string;
  items?: JobItem[];
}) {
  const scrollRootRef = useRef<HTMLDivElement>(null);

  return (
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <div ref={scrollRootRef}>
        <div data-radix-scroll-area-viewport="" />
      </div>
      <VirtualJobList
        items={items}
        effectiveSelectedId={selectedId}
        onSelect={() => {}}
        timeZone={null}
        scrollRootRef={scrollRootRef}
      />
    </NextIntlClientProvider>
  );
}

function VirtualKeyboardHarness() {
  const [selectedId, setSelectedId] = useState<string | null>(virtualJobs[5].id);
  const listRef = useRef<HTMLDivElement>(null);
  const scrollRootRef = useRef<HTMLDivElement>(null);
  const virtualListRef = useRef<VirtualJobListHandle>(null);
  const prepareRowFocus = useCallback((index: number) => {
    virtualListRef.current?.scrollToIndex(index);
  }, []);

  useKeyboardNavigation({
    containerRef: listRef,
    items: virtualJobs,
    selectedId,
    onSelect: setSelectedId,
    prepareRowFocus,
  });

  return (
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <div ref={scrollRootRef}>
        <div data-radix-scroll-area-viewport="" />
      </div>
      <div
        ref={listRef}
        role="list"
        tabIndex={selectedId === null ? 0 : -1}
        onFocusCapture={(event) => {
          const row = (event.target as HTMLElement).closest<HTMLElement>("[data-job-id]");
          if (row?.dataset.jobId) virtualMock.order.push(`focus:${row.dataset.jobId}`);
        }}
      >
        <VirtualJobList
          ref={virtualListRef}
          items={virtualJobs}
          effectiveSelectedId={selectedId}
          onSelect={setSelectedId}
          timeZone={null}
          scrollRootRef={scrollRootRef}
        />
      </div>
    </NextIntlClientProvider>
  );
}

beforeEach(() => {
  virtualMock.estimatedSize = 0;
  virtualMock.isScrolling = false;
  virtualMock.reducedMotion = false;
  virtualMock.startIndex = 0;
  virtualMock.endIndex = 1;
  virtualMock.measureElement.mockReset();
  virtualMock.order = [];
  virtualMock.scrollToIndex.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("VirtualJobList", () => {
  it("measures variable rows and publishes virtual list position", () => {
    const items = makeJobs(81, (index) => ({
      title: index % 2
        ? `Short ${index}`
        : `A deliberately long title ${index} with wrapped metadata`,
    }));

    render(<VirtualListHarness selectedId={items[0].id} items={items} />);

    const first = screen.getByRole("listitem", { name: /deliberately long/i });
    const wrapper = first.parentElement;
    expect(wrapper).not.toBeNull();
    expect.soft(virtualMock.estimatedSize).toBe(132);
    expect.soft(virtualMock.measureElement).toHaveBeenCalled();
    expect.soft(first).toHaveAttribute("aria-setsize", "81");
    expect.soft(first).toHaveAttribute("aria-posinset", "1");
    expect.soft(wrapper).toHaveAttribute("data-index", "0");
    expect.soft(wrapper).toHaveClass("pb-3");
    expect.soft(wrapper).not.toHaveStyle({ height: "88px" });
    expect.soft(wrapper?.style.height).toBe("");
  });

  it.each([
    { reason: "scrolling", isScrolling: true, reducedMotion: false },
    { reason: "reduced motion", isScrolling: false, reducedMotion: true },
  ])("disables transform transitions during $reason", ({ isScrolling, reducedMotion }) => {
    virtualMock.isScrolling = isScrolling;
    virtualMock.reducedMotion = reducedMotion;

    render(<VirtualListHarness selectedId={virtualJobs[0].id} />);

    const row = screen.getByRole("listitem", { name: /Virtual role 0/i });
    expect(row.parentElement).toHaveStyle({ transition: "none" });
  });

  it("keeps the offscreen active row mounted as the only row tab stop", () => {
    render(<VirtualListHarness selectedId={virtualJobs[8].id} />);

    const rows = [...document.querySelectorAll<HTMLButtonElement>("[data-job-id]")];
    const active = document.querySelector<HTMLButtonElement>("[data-job-id='virtual-8']");

    expect(active).toBeInTheDocument();
    expect(active).toHaveAttribute("aria-current", "true");
    expect(rows.filter((row) => row.tabIndex === 0)).toEqual([active]);
  });

  it("scrolls across the mounted range before mounting and focusing the next row", async () => {
    virtualMock.startIndex = 5;
    virtualMock.endIndex = 5;
    render(<VirtualKeyboardHarness />);
    const start = screen.getByRole("button", { name: /Virtual role 5/i });

    start.focus();
    virtualMock.order = [];
    fireEvent.keyDown(start, { key: "ArrowDown" });

    const target = await screen.findByRole("button", { name: /Virtual role 6/i });
    await waitFor(() => expect(target).toHaveFocus());
    expect(virtualMock.scrollToIndex).toHaveBeenCalledWith(6, { align: "auto" });
    expect(virtualMock.order.indexOf("scroll:6")).toBeLessThan(
      virtualMock.order.indexOf("focus:virtual-6"),
    );
  });

  it("keeps only the latest target when navigation requests arrive rapidly", async () => {
    virtualMock.startIndex = 5;
    virtualMock.endIndex = 5;
    render(<VirtualKeyboardHarness />);
    const start = screen.getByRole("button", { name: /Virtual role 5/i });

    start.focus();
    virtualMock.order = [];
    await act(async () => {
      start.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
      start.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    });

    const target = await screen.findByRole("button", { name: /Virtual role 7/i });
    await waitFor(() => expect(target).toHaveFocus());
    expect(virtualMock.scrollToIndex.mock.calls.map(([index]) => index)).toEqual([6, 7]);
    expect(document.querySelectorAll("[data-job-id][tabindex='0']")).toHaveLength(1);
  });
});
