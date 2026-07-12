import { useEffect, type RefObject } from "react";

export interface UseKeyboardNavigationOptions {
  containerRef: RefObject<HTMLElement | null>;
  items: Array<{ id: string }>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  enabled?: boolean;
}

const BLOCKING_TARGET = [
  "input",
  "textarea",
  "select",
  "a[href]",
  "[contenteditable='true']",
  "[role='dialog']",
  "[role='menu']",
  "[role='listbox']",
  "[role='combobox']",
].join(",");

function isOwnedRowTarget(target: EventTarget | null): boolean {
  const element = target instanceof Element ? target : null;
  if (!element) return false;
  return Boolean(element.closest("[data-job-id]")) || !element.closest(BLOCKING_TARGET);
}

function focusJob(container: HTMLElement, jobId: string) {
  const element = container.querySelector<HTMLElement>(
    `[data-job-id="${CSS.escape(jobId)}"]`,
  );
  if (!element) return;
  element.focus({ preventScroll: true });
  element.scrollIntoView({ block: "nearest" });
}

export function useKeyboardNavigation(options: UseKeyboardNavigationOptions) {
  const { containerRef, items, selectedId, onSelect, enabled = true } = options;

  useEffect(() => {
    const container = containerRef.current;
    if (!enabled || items.length === 0 || !container) return;

    function onKeyDown(event: KeyboardEvent) {
      const target = event.target instanceof Element ? event.target : null;
      if (!target || !container.contains(target) || !isOwnedRowTarget(target)) return;

      const key = event.key;
      const isNext = key === "j" || key === "ArrowDown";
      const isPrev = key === "k" || key === "ArrowUp";
      const isEscape = key === "Escape";

      if (!isNext && !isPrev && !isEscape) return;

      let currentIndex = items.findIndex((it) => it.id === selectedId);
      if (currentIndex < 0) currentIndex = 0;

      if (isEscape) {
        event.preventDefault();
        onSelect(null);
        return;
      }

      if (isNext) {
        if (currentIndex >= items.length - 1) return;
        event.preventDefault();
        const nextId = items[currentIndex + 1]!.id;
        onSelect(nextId);
        queueMicrotask(() => focusJob(container, nextId));
        return;
      }

      if (isPrev) {
        if (currentIndex <= 0) return;
        event.preventDefault();
        const prevId = items[currentIndex - 1]!.id;
        onSelect(prevId);
        queueMicrotask(() => focusJob(container, prevId));
      }
    }

    container.addEventListener("keydown", onKeyDown);
    return () => container.removeEventListener("keydown", onKeyDown);
  }, [containerRef, enabled, items, onSelect, selectedId]);
}
