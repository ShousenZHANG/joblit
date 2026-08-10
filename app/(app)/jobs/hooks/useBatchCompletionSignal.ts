"use client";

import { useEffect, useRef } from "react";
import type { BatchProgressState } from "./useBatchProgress";

/**
 * Tell the user a run finished even when they are not looking at this tab.
 *
 * Generation takes minutes, so nobody watches it. The banner only ever spoke
 * to someone already staring at the Jobs page; a user who switched tabs — the
 * reasonable thing to do while waiting — got no signal at all and came back
 * some indeterminate time later to find out by scrolling.
 *
 * Two channels, both cheap and both permission-free. The tab title carries a
 * live count, which is visible from any other tab. A toast fires once when the
 * batch settles, for the case where they are still here.
 */

type ToastFn = (input: {
  title: string;
  description?: string;
  variant?: "default" | "destructive";
}) => unknown;

export function useBatchCompletionSignal(input: {
  state: BatchProgressState;
  toast: ToastFn;
  /** Pre-resolved so this hook stays free of a translation dependency. */
  labels: {
    titlePrefix: (progress: { done: number; total: number }) => string;
    doneTitle: string;
    doneDescription: (counts: { succeeded: number; failed: number }) => string;
    failedTitle: string;
  };
}): void {
  const { state, toast, labels } = input;
  const labelsRef = useRef(labels);
  const toastRef = useRef(toast);
  useEffect(() => {
    labelsRef.current = labels;
    toastRef.current = toast;
  });

  // The title is restored on cleanup, so a navigation away cannot strand a
  // stale count in the tab strip.
  const active = state.active;
  const done = state.done;
  const total = state.total;
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!active) return;
    const original = document.title;
    document.title = labelsRef.current.titlePrefix({ done, total });
    return () => {
      document.title = original;
    };
  }, [active, done, total]);

  const announcedBatchRef = useRef<string | null>(null);
  const wasActiveRef = useRef(false);
  const batchId = state.batchId;
  const status = state.status;
  const succeeded = state.succeeded;
  const failed = state.failed;

  useEffect(() => {
    if (!batchId || !status) return;

    if (active) {
      wasActiveRef.current = true;
      return;
    }

    // Only announce a run this session actually watched running. Without this,
    // simply opening the Jobs page would toast about whatever batch finished
    // last — possibly days ago — every single time.
    if (!wasActiveRef.current) return;
    if (announcedBatchRef.current === batchId) return;
    announcedBatchRef.current = batchId;
    wasActiveRef.current = false;

    const everythingFailed = succeeded === 0 && failed > 0;
    toastRef.current({
      title: everythingFailed
        ? labelsRef.current.failedTitle
        : labelsRef.current.doneTitle,
      description: labelsRef.current.doneDescription({ succeeded, failed }),
      variant: everythingFailed ? "destructive" : "default",
    });
  }, [active, batchId, status, succeeded, failed]);
}
