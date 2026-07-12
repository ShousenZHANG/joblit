import { useCallback, useEffect, useRef, type RefObject } from "react";

export interface UseKeyboardNavigationOptions {
  containerRef: RefObject<HTMLElement | null>;
  items: Array<{ id: string }>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  prepareRowFocus?: (index: number) => void;
  enabled?: boolean;
}

const BLOCKING_TARGET = [
  "button",
  "input",
  "textarea",
  "select",
  "a",
  "[contenteditable]:not([contenteditable='false' i])",
  "dialog",
  "menu",
  "[role='dialog']",
  "[role='menu']",
  "[role='listbox']",
  "[role='combobox']",
].join(",");

function isOwnedRowTarget(target: EventTarget | null): boolean {
  const element = target instanceof Element ? target : null;
  if (!element) return false;
  const row = element.closest("[data-job-id]");
  if (!row) return false;
  const blocker = element.closest(BLOCKING_TARGET);
  return blocker === null || blocker === row;
}

function findJob(container: HTMLElement, jobId: string) {
  return container.querySelector<HTMLElement>(
    `[data-job-id="${CSS.escape(jobId)}"]`,
  );
}

export function useKeyboardNavigation(options: UseKeyboardNavigationOptions) {
  const {
    containerRef,
    items,
    selectedId,
    onSelect,
    prepareRowFocus,
    enabled = true,
  } = options;
  const selectedIdRef = useRef(selectedId);
  const focusRequestRef = useRef({ sequence: 0, frameId: null as number | null });

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const cancelPendingFocus = useCallback(() => {
    focusRequestRef.current.sequence += 1;
    if (focusRequestRef.current.frameId !== null) {
      cancelAnimationFrame(focusRequestRef.current.frameId);
      focusRequestRef.current.frameId = null;
    }
  }, []);

  const requestRowFocus = useCallback((container: HTMLElement, index: number, jobId: string) => {
    cancelPendingFocus();
    const requestSequence = focusRequestRef.current.sequence;
    let attemptsRemaining = 8;
    prepareRowFocus?.(index);

    const tryFocus = () => {
      if (
        focusRequestRef.current.sequence !== requestSequence ||
        containerRef.current !== container ||
        !container.isConnected
      ) {
        return;
      }

      const element = findJob(container, jobId);
      if (element) {
        focusRequestRef.current.frameId = null;
        element.focus({ preventScroll: true });
        element.scrollIntoView({ block: "nearest" });
        return;
      }

      if (attemptsRemaining <= 0) {
        focusRequestRef.current.frameId = null;
        return;
      }
      attemptsRemaining -= 1;
      focusRequestRef.current.frameId = requestAnimationFrame(tryFocus);
    };

    queueMicrotask(tryFocus);
  }, [cancelPendingFocus, containerRef, prepareRowFocus]);

  useEffect(() => cancelPendingFocus, [cancelPendingFocus]);

  useEffect(() => {
    const currentContainer = containerRef.current;
    if (!enabled || items.length === 0 || !currentContainer) return;
    const container: HTMLElement = currentContainer;

    function onKeyDown(event: KeyboardEvent) {
      const target = event.target instanceof Element ? event.target : null;
      if (!target || !container.contains(target) || !isOwnedRowTarget(target)) return;

      const key = event.key;
      const isNext = key === "j" || key === "ArrowDown";
      const isPrev = key === "k" || key === "ArrowUp";
      const isEscape = key === "Escape";

      if (!isNext && !isPrev && !isEscape) return;

      let currentIndex = items.findIndex((it) => it.id === selectedIdRef.current);
      if (currentIndex < 0) currentIndex = 0;

      if (isEscape) {
        event.preventDefault();
        cancelPendingFocus();
        const requestSequence = focusRequestRef.current.sequence;
        selectedIdRef.current = null;
        onSelect(null);
        queueMicrotask(() => {
          if (
            focusRequestRef.current.sequence === requestSequence &&
            containerRef.current === container &&
            container.isConnected
          ) {
            container.focus({ preventScroll: true });
          }
        });
        return;
      }

      if (isNext) {
        if (currentIndex >= items.length - 1) return;
        event.preventDefault();
        const nextIndex = currentIndex + 1;
        const nextId = items[nextIndex]!.id;
        selectedIdRef.current = nextId;
        onSelect(nextId);
        requestRowFocus(container, nextIndex, nextId);
        return;
      }

      if (isPrev) {
        if (currentIndex <= 0) return;
        event.preventDefault();
        const prevIndex = currentIndex - 1;
        const prevId = items[prevIndex]!.id;
        selectedIdRef.current = prevId;
        onSelect(prevId);
        requestRowFocus(container, prevIndex, prevId);
      }
    }

    container.addEventListener("keydown", onKeyDown);
    return () => container.removeEventListener("keydown", onKeyDown);
  }, [cancelPendingFocus, containerRef, enabled, items, onSelect, requestRowFocus]);
}
