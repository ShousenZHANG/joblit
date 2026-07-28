"use client";

import { useEffect } from "react";

type GuidePanelShortcutOptions = {
  enabled: boolean;
  panelOpen: boolean;
  onClose: () => void;
  onToggle: () => void;
};

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return (
    target.isContentEditable ||
    tag === "input" ||
    tag === "textarea" ||
    tag === "select"
  );
}

export function useGuidePanelShortcut({
  enabled,
  panelOpen,
  onClose,
  onToggle,
}: GuidePanelShortcutOptions) {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (event.key === "Escape" && panelOpen) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "?" && !(event.shiftKey && event.key === "/")) return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      onToggle();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, onClose, onToggle, panelOpen]);
}
