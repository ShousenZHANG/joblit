import { useEffect } from "react";

export interface UseKeyboardNavigationOptions {
  items: Array<{ id: string }>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  enabled?: boolean;
}

function isTypingTarget(active: Element | null): boolean {
  const tag = active?.tagName;
  return tag === "INPUT" || tag === "TEXTAREA";
}

function scrollJobIntoView(jobId: string) {
  const el = document.querySelector(`[data-job-id="${CSS.escape(jobId)}"]`);
  el?.scrollIntoView({ block: "nearest" });
}

export function useKeyboardNavigation(options: UseKeyboardNavigationOptions) {
  const { items, selectedId, onSelect, enabled = true } = options;

  useEffect(() => {
    if (!enabled || items.length === 0) return;

    function onKeyDown(event: KeyboardEvent) {
      if (isTypingTarget(document.activeElement)) return;

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
        queueMicrotask(() => scrollJobIntoView(nextId));
        return;
      }

      if (isPrev) {
        if (currentIndex <= 0) return;
        event.preventDefault();
        const prevId = items[currentIndex - 1]!.id;
        onSelect(prevId);
        queueMicrotask(() => scrollJobIntoView(prevId));
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [enabled, items, onSelect, selectedId]);
}
