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
  rangeExtractor?: (range: MockRange) => number[];
};

const virtualMock = vi.hoisted(() => ({
  startIndex: 0,
  endIndex: 1,
  order: [] as string[],
  scrollToIndex: vi.fn(),
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
      const range = {
        startIndex: virtualMock.startIndex,
        endIndex: virtualMock.endIndex,
        overscan: 0,
        count: options.count,
      };
      const indexes = (options.rangeExtractor ?? defaultRangeExtractor)(range);

      return {
        isScrolling: false,
        getTotalSize: () => options.count * 88,
        getVirtualItems: () => indexes.map((index) => ({
          key: index,
          index,
          start: index * 88,
          end: (index + 1) * 88,
          size: 88,
          lane: 0,
        })),
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
const virtualJobs: JobItem[] = Array.from({ length: 12 }, (_, index) => ({
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
}));

function VirtualListHarness({ selectedId }: { selectedId: string }) {
  const scrollRootRef = useRef<HTMLDivElement>(null);

  return (
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <div ref={scrollRootRef}>
        <div data-radix-scroll-area-viewport="" />
      </div>
      <VirtualJobList
        items={virtualJobs}
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
  virtualMock.startIndex = 0;
  virtualMock.endIndex = 1;
  virtualMock.order = [];
  virtualMock.scrollToIndex.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("VirtualJobList keyboard integration", () => {
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
