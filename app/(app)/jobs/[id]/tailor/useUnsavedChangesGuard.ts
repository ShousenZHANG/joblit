"use client";

import { useEffect } from "react";

/**
 * Warn before the tab closes while edits are still unsaved.
 *
 * The route page had this and the review dialog did not, so whether a user was
 * warned about losing work depended on which Edit surface they had opened. Both
 * autosave on a debounce, so both have a window where a close loses edits.
 *
 * `preventDefault` is the whole implementation: browsers show their own copy
 * and ignore any string returned here.
 */
export function useUnsavedChangesGuard(hasUnsavedWork: boolean): void {
  useEffect(() => {
    if (!hasUnsavedWork) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasUnsavedWork]);
}
