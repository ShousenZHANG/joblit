"use client";

import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useState,
  type RefObject,
} from "react";
import { defaultRangeExtractor, useVirtualizer, type Range } from "@tanstack/react-virtual";
import { useReducedMotion } from "framer-motion";

import type { JobItem } from "../types";
import { JobListItem } from "./JobListItem";

const ROW_ESTIMATE_PX = 132;
const ROW_OVERSCAN = 5;

export interface VirtualJobListHandle {
  scrollToIndex: (index: number) => void;
}

interface VirtualJobListProps {
  items: JobItem[];
  effectiveSelectedId: string | null;
  onSelect: (id: string) => void;
  timeZone: string | null;
  scrollRootRef: RefObject<HTMLDivElement | null>;
  batchMode?: boolean;
  batchSelectedIds?: Set<string>;
  onBatchToggle?: (id: string) => void;
}

export const VirtualJobList = forwardRef<VirtualJobListHandle, VirtualJobListProps>(function VirtualJobList({
  items,
  effectiveSelectedId,
  onSelect,
  timeZone,
  scrollRootRef,
  batchMode,
  batchSelectedIds,
  onBatchToggle,
}: VirtualJobListProps, ref) {
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);
  const reducedMotion = useReducedMotion();
  const activeIndex = useMemo(
    () => items.findIndex((item) => item.id === effectiveSelectedId),
    [effectiveSelectedId, items],
  );
  const rangeExtractor = useCallback((range: Range) => {
    const indexes = defaultRangeExtractor(range);
    if (activeIndex < 0 || indexes.includes(activeIndex)) return indexes;
    return [...indexes, activeIndex].sort((left, right) => left - right);
  }, [activeIndex]);

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

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => ROW_ESTIMATE_PX,
    measureElement: (element) => element.getBoundingClientRect().height,
    overscan: ROW_OVERSCAN,
    rangeExtractor,
  });

  useImperativeHandle(ref, () => ({
    scrollToIndex(index: number) {
      virtualizer.scrollToIndex(index, { align: "auto" });
    },
  }), [virtualizer]);

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
              ref={virtualizer.measureElement}
              data-index={virtualRow.index}
              className="absolute left-0 top-0 w-full pb-3"
              style={{
                transform: `translateY(${virtualRow.start}px)`,
                transition: isScrolling || reducedMotion
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
                setSize={items.length}
                positionInSet={virtualRow.index + 1}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
});
