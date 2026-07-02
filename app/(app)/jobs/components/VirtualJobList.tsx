"use client";

import { useLayoutEffect, useState, type RefObject } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import type { JobItem } from "../types";
import { JobListItem } from "./JobListItem";

const ROW_ESTIMATE_PX = 88;
const ROW_OVERSCAN = 5;

export function VirtualJobList({
  items,
  effectiveSelectedId,
  onSelect,
  timeZone,
  scrollRootRef,
  batchMode,
  batchSelectedIds,
  onBatchToggle,
}: {
  items: JobItem[];
  effectiveSelectedId: string | null;
  onSelect: (id: string) => void;
  timeZone: string | null;
  scrollRootRef: RefObject<HTMLDivElement | null>;
  batchMode?: boolean;
  batchSelectedIds?: Set<string>;
  onBatchToggle?: (id: string) => void;
}) {
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const root = scrollRootRef.current;
    if (!root) return;
    const resolve = () => {
      const el = root.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]");
      setScrollElement((prev) => (prev === el ? prev : el));
    };
    resolve();
    const raf = requestAnimationFrame(resolve);
    return () => cancelAnimationFrame(raf);
  }, [scrollRootRef, items.length]);

  // TanStack Virtual's `useVirtualizer()` returns functions whose identity is
  // not memoization-safe; the React Compiler correctly skips this hook. The
  // accompanying lint rule is informational only — silence it here.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => ROW_ESTIMATE_PX,
    overscan: ROW_OVERSCAN,
  });

  // Animate row repositioning (e.g. when a row above is deleted, the rows
  // below slide up smoothly instead of snapping). Disabled mid-scroll so
  // the transition never lags behind the user's scroll position.
  const isScrolling = virtualizer.isScrolling;

  return (
    <div className="p-3">
      <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const job = items[virtualRow.index];
          if (!job) return null;
          return (
            <div
              key={job.id}
              className="absolute left-0 top-0 w-full"
              style={{
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
                transition: isScrolling
                  ? "none"
                  : "transform 220ms cubic-bezier(0.16, 1, 0.3, 1)",
                willChange: "transform",
              }}
            >
              <JobListItem
                job={job}
                isActive={job.id === effectiveSelectedId}
                onSelect={() => onSelect(job.id)}
                timeZone={timeZone}
                batchMode={batchMode}
                batchSelected={batchSelectedIds?.has(job.id)}
                onBatchToggle={onBatchToggle}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
