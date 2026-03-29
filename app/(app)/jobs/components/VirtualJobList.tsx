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
}: {
  items: JobItem[];
  effectiveSelectedId: string | null;
  onSelect: (id: string) => void;
  timeZone: string | null;
  scrollRootRef: RefObject<HTMLDivElement | null>;
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

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => ROW_ESTIMATE_PX,
    overscan: ROW_OVERSCAN,
  });

  return (
    <div className="p-3">
      <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const job = items[virtualRow.index];
          if (!job) return null;
          return (
            <div
              key={virtualRow.key}
              className="absolute left-0 top-0 w-full"
              style={{
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <JobListItem
                job={job}
                isActive={job.id === effectiveSelectedId}
                onSelect={() => onSelect(job.id)}
                timeZone={timeZone}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
