import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react";

interface UseKeyboardNavigationOptions {
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
  const focusRequestRef = useRef({
    sequence: 0,
    frameId: null as number | null,
    targetId: null as string | null,
    originId: null as string | null,
  });

  const cancelPendingFocus = useCallback(() => {
    focusRequestRef.current.sequence += 1;
    if (focusRequestRef.current.frameId !== null) {
      cancelAnimationFrame(focusRequestRef.current.frameId);
      focusRequestRef.current.frameId = null;
    }
    focusRequestRef.current.targetId = null;
    focusRequestRef.current.originId = null;
  }, []);

  useLayoutEffect(() => {
    selectedIdRef.current = selectedId;
    const pendingTargetId = focusRequestRef.current.targetId;
    if (pendingTargetId !== null && pendingTargetId !== selectedId) {
      cancelPendingFocus();
    }
  }, [cancelPendingFocus, selectedId]);

  const requestRowFocus = useCallback((
    container: HTMLElement,
    index: number,
    jobId: string,
    originId: string | null,
  ) => {
    cancelPendingFocus();
    const requestSequence = focusRequestRef.current.sequence;
    focusRequestRef.current.targetId = jobId;
    focusRequestRef.current.originId = originId;
    let attemptsRemaining = 8;
    prepareRowFocus?.(index);

    const tryFocus = () => {
      if (
        focusRequestRef.current.sequence !== requestSequence ||
        focusRequestRef.current.targetId !== jobId ||
        selectedIdRef.current !== jobId ||
        containerRef.current !== container ||
        !container.isConnected
      ) {
        return;
      }

      const element = findJob(container, jobId);
      if (element) {
        focusRequestRef.current.frameId = null;
        focusRequestRef.current.targetId = null;
        focusRequestRef.current.originId = null;
        element.focus({ preventScroll: true });
        element.scrollIntoView({ block: "nearest" });
        return;
      }

      if (attemptsRemaining <= 0) {
        focusRequestRef.current.frameId = null;
        focusRequestRef.current.targetId = null;
        focusRequestRef.current.originId = null;
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
      if (!target || !container.contains(target)) return;
      const isClearedListRoot = target === container && selectedIdRef.current === null;
      if (!isClearedListRoot && !isOwnedRowTarget(target)) return;

      const key = event.key;
      const isNext = key === "j" || key === "ArrowDown";
      const isPrev = key === "k" || key === "ArrowUp";
      const isEscape = key === "Escape";

      if (!isNext && !isPrev && !isEscape) return;

      if (isClearedListRoot) {
        if (!isNext && !isPrev) return;
        event.preventDefault();
        const resumeIndex = isNext ? 0 : items.length - 1;
        const resumeId = items[resumeIndex]!.id;
        selectedIdRef.current = resumeId;
        onSelect(resumeId);
        requestRowFocus(container, resumeIndex, resumeId, null);
        return;
      }

      const focusedRowId = target.closest<HTMLElement>("[data-job-id]")?.dataset.jobId;
      const validFocusedRowId = focusedRowId && items.some((item) => item.id === focusedRowId)
        ? focusedRowId
        : null;
      const pendingCursorId = validFocusedRowId !== null &&
        focusRequestRef.current.originId === validFocusedRowId
        ? focusRequestRef.current.targetId
        : null;
      const cursorId = pendingCursorId ?? validFocusedRowId ?? selectedIdRef.current;
      let currentIndex = items.findIndex((it) => it.id === cursorId);
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
        requestRowFocus(container, nextIndex, nextId, validFocusedRowId ?? cursorId);
        return;
      }

      if (isPrev) {
        if (currentIndex <= 0) return;
        event.preventDefault();
        const prevIndex = currentIndex - 1;
        const prevId = items[prevIndex]!.id;
        selectedIdRef.current = prevId;
        onSelect(prevId);
        requestRowFocus(container, prevIndex, prevId, validFocusedRowId ?? cursorId);
      }
    }

    container.addEventListener("keydown", onKeyDown);
    return () => container.removeEventListener("keydown", onKeyDown);
  }, [cancelPendingFocus, containerRef, enabled, items, onSelect, requestRowFocus]);
}
